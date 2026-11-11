/**
 * Task routing (分流): one rule, two lanes.
 *
 * Shape of traffic, not number of keys: short interactive tasks and long
 * batch tasks are routed to different lanes so they never block each other.
 *  - fast lane: short interactive tasks (Jev intake, llm-judge, probes).
 *  - bulk lane: long agent runs (review/fix-issue/split-plan, smoke, e2e).
 *
 * Lane -> key mapping lives in env (see below); routing policy lives here.
 * Canonical secret names (org level):
 *  - fast lane: OPENCODE_API_KEY (legacy LLM_API_KEY accepted as alias)
 *  - bulk lane: OPENCODE_API_KEY_BULK
 * Optional overrides (win when set, e.g. per-repo routing or key rotation):
 *  - KEY_FAST, KEY_BULK
 *
 * Policy (see README "任务分流"):
 * - SHORT tasks: primary = fast lane, immediate failover to bulk on rate limit.
 *   A 10-minute task must never wait hours for a quota window.
 * - LONG tasks: bulk lane ONLY when configured (strict isolation protects the
 *   fast lane's guaranteed capacity). On rate limit the agent CLI backs off and
 *   waits; a 2h task starting 5h later is fine. No failover to fast.
 * - Bootstrap: when bulk is not configured at all, long tasks use fast
 *   (status quo ante; nothing breaks where only one key exists).
 */

export interface LaneKeys {
  fast: string
  bulk: string
}

/** Resolve lane -> key, honoring explicit overrides first. */
export function laneKeys(env: NodeJS.ProcessEnv = process.env): LaneKeys {
  const fast = env.KEY_FAST || env.OPENCODE_API_KEY || env.LLM_API_KEY || ""
  const bulk = env.KEY_BULK || env.OPENCODE_API_KEY_BULK || ""
  return { fast, bulk }
}

export type TaskKind = "short" | "long"

export interface KeyPlan {
  /** Key to try first. Empty when no key is configured at all. */
  primary: string
  /** Key to try on rate-limit, or "" when failover is not allowed. */
  fallback: string
}

/**
 * Select keys for a task. Short tasks fail over fast -> bulk.
 * Long tasks stick to bulk; only when bulk is entirely absent do they
 * fall back to fast (so single-key setups keep working).
 */
export function keysFor(env: NodeJS.ProcessEnv, task: TaskKind): KeyPlan {
  const { fast, bulk } = laneKeys(env)
  if (task === "short") return { primary: fast, fallback: fast === bulk ? "" : bulk }
  if (bulk) return { primary: bulk, fallback: "" }
  return { primary: fast, fallback: "" }
}

/** True when an error looks like a rate limit (status 429 or message match). */
export function isRateLimited(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "")
  const m = msg.match(/(?:^|\s)(\d{3})(?:\s|:|$)/)
  if (m) return Number(m[1]) === 429
  return /rate.?limit|too many requests|quota exceeded|quota exhausted/i.test(msg)
}

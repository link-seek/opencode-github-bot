/**
 * Jev intake call (#9): ONE request, questions evaluated in parallel, same state.
 * Follows https://docs.typesafe.ai (primitives: choice/score/noul):
 *  - scores are NORMALIZED to 0-1 (raw score / top level number) before routing;
 *  - score confidences gate automation (low confidence -> human);
 *  - duplicates use one Noul per candidate (same_as_<n>), giving attribution.
 * Single model variable, JSON: {"cli":"...","apiBase":"..."} (see model-target.ts).
 * Dual-value (#120): optional fallback_cli/fallback_apiBase add a backup model
 * tried on the SAME key after a 429/quota on the primary (then bulk lane).
 *  - CLI uses `cli` verbatim. API uses `apiBase` + id (`apiId` or after last "/").
 * Opencode only. Legacy space-separated/bare values still parse.
 * Key: OPENCODE_API_KEY else inputs.llm-api-key. No key -> null (fail-closed).
 */
import { modelTargets, parseModelVar } from "./model-target"
import { isRateLimited, keysFor } from "./keys"
import { withSpan } from "./trace"
export const DEFAULT_JEV_MODEL = "jev-1.13-free"
export const DEFAULT_JEV_URL = "https://opencode.ai/inference/systemone/v1/systemone"

export interface CandidateDoc {
  number: number
  title: string
  summary: string
}

export interface JevScores {
  repo_fit: number // noul 0-1 (already 0-1, no normalization needed)
  is_clear: number // normalized 0-1 (raw / 2)
  type: string
  typeConfidence: number // 0-1
  size: number // normalized 0-1 (raw / 3)
  priority: number // normalized 0-1 (raw / 3)
  duplicate: number | null // max same_as noul, null when no candidates
  duplicateOf: number[] // candidate numbers with noul >= 0.7
  confidences: { is_clear: number; size: number; priority: number }
  model: string
}

export interface IntakeState {
  role: string
  freshTitle: string
  freshBody: string
  fileCheck?: string
}

/** State holds role + NEW issue only; candidates travel in per-record Nouls. */
export function buildJevState(s: IntakeState): string {
  const parts = [`ROLE: ${s.role}`, `NEW: ${s.freshTitle}\n${s.freshBody}`]
  if (s.fileCheck) parts.push(`FILECHECK:\n${s.fileCheck}`)
  return parts.join("\n")
}

const SAME_QUESTION = "Is the NEW issue the same underlying problem as `candidate` (same problem, not just same words)?"

export function buildJevQuestions(roleHint: string, candidates: CandidateDoc[]) {
  const questions: Record<string, unknown> = {
    repo_fit: {
      type: "noul",
      instructions: `Does this issue belong to this repo? Repo duties: ${roleHint}. Answer true only if clearly in scope.`,
      criteria: {
        true: "Work this repo owns per its duties (action wiring, plugin tools, prompts, docs, triage pipeline)",
        false: "Upstream OpenCode bug, another repo's scope, or a user business need",
      },
    },
    is_clear: {
      type: "score",
      instructions: "How clear is this issue (background + current state + expectation)?",
      criteria: ["Unclear, missing key parts", "Partially clear", "Fully clear and actionable"],
    },
    type: {
      type: "choice",
      instructions: "What kind of issue is this?",
      criteria: {
        bug: "Something broken, error, regression",
        feature: "New capability or enhancement request",
        docs: "Documentation, examples, typo",
      },
    },
    size: {
      type: "score",
      instructions: "What is the scope of the change this issue needs?",
      criteria: [
        "Single small edit in one place, no cross-file impact",
        "Change confined to one module, no API changes",
        "Change spans modules or shared behavior, needs coordination",
        "Cross-cutting or architectural change, must be split",
      ],
    },
    priority: {
      type: "score",
      instructions: "How urgent/important? Higher means fix sooner.",
      criteria: ["Low", "Normal", "High", "Critical blocker"],
    },
  }
  for (const c of candidates) {
    questions[`same_as_${c.number}`] = {
      type: "noul",
      instructions: {
        candidate: { number: c.number, title: c.title, summary: c.summary },
        question: SAME_QUESTION,
      },
    }
  }
  return questions
}

/** Normalize a raw score (0..topLevel) to 0-1. */
export function normalizeScore(raw: number, levels: number): number {
  if (!Number.isFinite(raw)) return 0
  return Math.min(1, Math.max(0, raw / Math.max(1, levels - 1)))
}

export const SCORE_LEVELS = { is_clear: 3, size: 4, priority: 4 } as const

export interface JevEndpoint {
  url: string
  key: string
  /** Failover key (bulk lane) for short tasks. Empty when failover is not configured. */
  fallbackKey?: string
  model?: string
  /** Fallback model on the SAME key (lane-internal, #120). Absent = no fallback. */
  fallbackModel?: string
  /** Endpoint for the fallback model (defaults to `url` when empty). */
  fallbackUrl?: string
}

export function resolveJevTarget(raw: string): { url: string; model: string; fallbackUrl?: string; fallbackModel?: string } | null {
  const v = parseModelVar(raw)
  if (!v.apiId) return null
  const targets = modelTargets(v)
  const primary = targets[0]
  const out: { url: string; model: string; fallbackUrl?: string; fallbackModel?: string } = {
    url: primary.apiBase || DEFAULT_JEV_URL,
    model: primary.apiId,
  }
  const fb = targets[1]
  if (fb) {
    const fbUrl = fb.apiBase || primary.apiBase || DEFAULT_JEV_URL
    // Same-model fallback is a no-op: treat as no fallback to keep logs honest.
    if (fb.apiId !== primary.apiId || fbUrl !== out.url) {
      out.fallbackModel = fb.apiId
      if (fb.apiBase) out.fallbackUrl = fb.apiBase
    }
  }
  return out
}

export function jevEndpointFromEnv(env: NodeJS.ProcessEnv = process.env): JevEndpoint | null {
  // Dedicated secret first: inputs.llm-api-key may carry a non-OpenCode key
  // meant for the agent chat model, which must not override the Jev key.
  const t = resolveJevTarget(env.JEV_MODEL || "")
  if (!t) return null
  const { url, model } = t
  const plan = keysFor(env, "short")
  if (!plan.primary) return null
  const ep: JevEndpoint = { url, model, key: plan.primary, fallbackKey: plan.fallback || undefined }
  if (t.fallbackModel) {
    ep.fallbackModel = t.fallbackModel
    if (t.fallbackUrl) ep.fallbackUrl = t.fallbackUrl
  }
  return ep
}

function num(v: any, fb = 0): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fb
}

/** Call Jev once. Returns null when no key (caller skips semantic triage).
 * Short-task routing: on rate-limit the call first falls back to the backup
 * MODEL on the same key (#120), then to the bulk lane (same model order).
 * A 10-minute task must never wait hours for a window. */
export async function jevIntake(
  state: IntakeState,
  candidates: CandidateDoc[],
  ep?: JevEndpoint | null,
  fetchFn: typeof fetch = fetch,
  traceCtx?: { issueNumber?: number; prNumber?: number; mode?: string },
): Promise<JevScores | null> {
  const endpoint = ep === undefined ? jevEndpointFromEnv() : ep
  if (!endpoint) return null
  // Model default matches the resolved (opencode-family) endpoint.
  const model = endpoint.model || DEFAULT_JEV_MODEL
  const attrs: Record<string, unknown> = {
    "mode": traceCtx?.mode ?? "intake",
    "model.id": model,
  }
  if (traceCtx?.issueNumber != null) attrs["issue.number"] = traceCtx.issueNumber
  if (traceCtx?.prNumber != null) attrs["pr.number"] = traceCtx.prNumber
  return await withSpan("jev.intake", attrs, async () => {
  // opencode.ai sits behind Cloudflare, which bans default script UAs (403/1010).
  // Send a browser-grade UA like the verified probe does.
  const callJev = (key: string, url: string, m: string) =>
    fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      body: JSON.stringify({
        model: m,
        state: buildJevState(state),
        questions: buildJevQuestions(state.role, candidates),
      }),
    })
  // Lane-internal model order: primary, then fallback on the SAME key.
  const models: Array<{ url: string; model: string; label: string }> = [
    { url: endpoint.url, model, label: "primary" },
  ]
  if (endpoint.fallbackModel) {
    models.push({
      url: endpoint.fallbackUrl || endpoint.url,
      model: endpoint.fallbackModel,
      label: "fallback",
    })
  }
  const lanes: Array<{ key: string; label: string }> = [{ key: endpoint.key, label: "fast lane" }]
  if (endpoint.fallbackKey) lanes.push({ key: endpoint.fallbackKey, label: "bulk lane" })
  let res: any = null
  let usedModel = model
  let lastErr: unknown = null
  for (let li = 0; li < lanes.length; li++) {
    for (let mi = 0; mi < models.length; mi++) {
      const lane = lanes[li]
      const target = models[mi]
      try {
        const attempt = await callJev(lane.key, target.url, target.model)
        if (!attempt.ok) {
          const t = await attempt.text().catch(() => "")
          throw new Error(`jev: ${attempt.status} ${t.slice(0, 300)}`)
        }
        res = attempt
        usedModel = target.model
        li = lanes.length // break outer
        break
      } catch (e) {
        lastErr = e
        if (!isRateLimited(e)) throw e
        const hasModelNext = mi + 1 < models.length
        const hasLaneNext = !hasModelNext && li + 1 < lanes.length
        if (!hasModelNext && !hasLaneNext) throw e
        if (hasModelNext) {
          const fb = models[mi + 1]
          console.log(`jev rate-limited on ${lane.label} (${target.model}), switching to fallback model ${fb.model} on same key`)
        } else {
          console.log(`jev rate-limited on ${lane.label}, failing over to bulk lane`)
        }
      }
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error("jev: no response")
  const data = await res.json().catch(() => {
    throw new Error("jev: non-JSON 2xx response")
  }) as any
  const a = data?.answers ?? {}
  const typeAns = a?.type ?? {}
  const dupOf: number[] = []
  let dupMax = 0
  for (const c of candidates) {
    const v = num(a?.[`same_as_${c.number}`]?.noul, NaN)
    if (Number.isFinite(v)) {
      if (v > dupMax) dupMax = v
      if (v >= 0.7) dupOf.push(c.number)
    }
  }
  dupOf.sort((x, y) => x - y)
  return {
    repo_fit: num(a?.repo_fit?.noul, 0),
    is_clear: normalizeScore(num(a?.is_clear?.score, 0), SCORE_LEVELS.is_clear),
    type: typeof typeAns?.choice === "string" ? typeAns.choice : "bug",
    typeConfidence: num(typeAns?.confidence, 0),
    size: normalizeScore(num(a?.size?.score, 0), SCORE_LEVELS.size),
    priority: normalizeScore(num(a?.priority?.score, 0), SCORE_LEVELS.priority),
    duplicate: candidates.length > 0 ? dupMax : null,
    duplicateOf: dupOf,
    confidences: {
      is_clear: num(a?.is_clear?.confidence, 0),
      size: num(a?.size?.confidence, 0),
      priority: num(a?.priority?.confidence, 0),
    },
    model: data?.model || usedModel,
  }
  })
}

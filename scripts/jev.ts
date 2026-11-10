/**
 * Jev intake call (#9): ONE request, questions evaluated in parallel, same state.
 * Follows https://docs.typesafe.ai (primitives: choice/score/noul):
 *  - scores are NORMALIZED to 0-1 (raw score / top level number) before routing;
 *  - score confidences gate automation (low confidence -> human);
 *  - duplicates use one Noul per candidate (same_as_<n>), giving attribution.
 * Single model variable: "<cli-model> <api-base-url>" (see model-target.ts).
 *  - CLI uses the first token as-is.
 *  - API uses the second token as endpoint + id after the last "/".
 * Opencode only. Single token (legacy) = CLI form, endpoint defaults to gateway.
 * Key: OPENCODE_API_KEY else inputs.llm-api-key. No key -> null (fail-closed).
 */
import { parseModelVar } from "./model-target"
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
}

/** State holds role + NEW issue only; candidates travel in per-record Nouls. */
export function buildJevState(s: IntakeState): string {
  return [`ROLE: ${s.role}`, `NEW: ${s.freshTitle}\n${s.freshBody}`].join("\n")
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
  model?: string
}

export function resolveJevTarget(raw: string): { url: string; model: string } | null {
  const v = parseModelVar(raw)
  if (!v.apiId) return null
  return { url: v.apiBase || DEFAULT_JEV_URL, model: v.apiId }
}

export function jevEndpointFromEnv(env: NodeJS.ProcessEnv = process.env): JevEndpoint | null {
  // Dedicated secret first: inputs.llm-api-key may carry a non-OpenCode key
  // meant for the agent chat model, which must not override the Jev key.
  const t = resolveJevTarget(env.JEV_MODEL || "")
  if (!t) return null
  const { url, model } = t
  const key = env.OPENCODE_API_KEY || env.LLM_API_KEY || ""
  if (!key) return null
  return { url, key, model }
}

function num(v: any, fb = 0): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fb
}

/** Call Jev once. Returns null when no key (caller skips semantic triage). */
export async function jevIntake(
  state: IntakeState,
  candidates: CandidateDoc[],
  ep?: JevEndpoint | null,
  fetchFn: typeof fetch = fetch,
): Promise<JevScores | null> {
  const endpoint = ep === undefined ? jevEndpointFromEnv() : ep
  if (!endpoint) return null
  // Model default matches the resolved (opencode-family) endpoint.
  const model = endpoint.model || DEFAULT_JEV_MODEL
  // opencode.ai sits behind Cloudflare, which bans default script UAs (403/1010).
  // Send a browser-grade UA like the verified probe does.
  const res = await fetchFn(endpoint.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.key}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    body: JSON.stringify({
      model,
      state: buildJevState(state),
      questions: buildJevQuestions(state.role, candidates),
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(`jev: ${res.status} ${t.slice(0, 300)}`)
  }
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
    model: data?.model || model,
  }
}

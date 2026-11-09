/**
 * Jev intake call (#9): ONE request, questions evaluated in parallel, same state.
 * Follows https://docs.typesafe.ai (primitives: choice/score/noul):
 *  - scores are NORMALIZED to 0-1 (raw score / top level number) before routing;
 *  - score confidences gate automation (low confidence -> human);
 *  - duplicates use one Noul per candidate (same_as_<n>), giving attribution.
 * Single endpoint path, fully env-parametrized (#9 follow-up):
 *  - JEV_URL / JEV_MODEL / JEV_API_KEY (key also accepts OPENCODE_API_KEY,
 *    TS_API_KEY, TYPESAFE_API_KEY for compat). Defaults = OpenCode gateway.
 *  - No key -> null (caller skips semantic triage, fail-closed to human).
 */
export const DEFAULT_JEV_URL = "https://opencode.ai/inference/systemone/v1/systemone"
export const DEFAULT_JEV_MODEL = "jev-1.13"

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
  model: string
}

export function jevEndpointFromEnv(env: NodeJS.ProcessEnv = process.env): JevEndpoint | null {
  const key = env.JEV_API_KEY ?? env.OPENCODE_API_KEY ?? env.TS_API_KEY ?? env.TYPESAFE_API_KEY
  if (!key) return null
  return {
    url: env.JEV_URL || DEFAULT_JEV_URL,
    key,
    model: env.JEV_MODEL || DEFAULT_JEV_MODEL,
  }
}

function num(v: any, fb = 0): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fb
}

/** Call Jev once. Returns null when no key (caller skips semantic triage). */
export async function jevIntake(
  state: IntakeState,
  candidates: CandidateDoc[],
  ep: JevEndpoint | null = jevEndpointFromEnv(),
  fetchFn: typeof fetch = fetch,
): Promise<JevScores | null> {
  if (!ep) return null
  const res = await fetchFn(ep.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ep.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ep.model,
      state: buildJevState(state),
      questions: buildJevQuestions(state.role, candidates),
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(`jev: ${res.status} ${t.slice(0, 300)}`)
  }
  const data = (await res.json()) as any
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
    model: data?.model ?? ep.model,
  }
}

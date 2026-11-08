/**
 * Jev intake call (#9): ONE request, 6 questions in parallel, same state.
 * Endpoint: OpenCode systemone gateway (OPENCODE_API_KEY) by default,
 * fallback direct TypeSafe (TS_API_KEY). Model pinned, never alias.
 */

export const JEV_MODEL = "jev-1.13.0"
export const JEV_MODEL_OPENCODE = "jev-1.13-free"
export const JEV_OPENCODE_URL = "https://opencode.ai/inference/systemone/v1/systemone"
export const JEV_DIRECT_URL = "https://api.typesafe.ai/v1/systemone"

export interface JevScores {
  repo_fit: number
  is_clear: number
  type: string
  typeConfidence: number
  size: number
  priority: number
  duplicate: number
  duplicateOf: number[]
  model: string
}

export interface IntakeState {
  role: string
  freshTitle: string
  freshBody: string
  candidates: Array<{ number: number; title: string; summary: string }>
}

export function buildJevState(s: IntakeState, perDocMax = 200): string {
  const one = (t: string) => {
    const x = t.replace(/\s+/g, " ").trim()
    return x.length <= perDocMax ? x : x.slice(0, perDocMax) + "…"
  }
  const cands = s.candidates
    .map((c) => `#${c.number}: ${one(c.title)} — ${one(c.summary)}`)
    .join("\n")
  return [
    `ROLE: ${s.role}`,
    `NEW: ${s.freshTitle}\n${s.freshBody}`,
    `CANDIDATES:\n${cands || "(none)"}`,
  ].join("\n")
}

export function buildJevQuestions(roleHint: string) {
  return {
    repo_fit: {
      type: "noul",
      instructions: `Does this issue belong to this repo? Repo duties: ${roleHint}. Answer true only if clearly in scope.`,
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
      instructions: "How big is the work? XS=single small file <half day; S=2-3 files one module <1 day; M=cross-module or 3-5 files 1-3 days; L=cross-repo or architecture >3 days.",
      criteria: ["XS trivial", "S small", "M medium needs split", "L large must split"],
    },
    priority: {
      type: "score",
      instructions: "How urgent/important? Higher means fix sooner.",
      criteria: ["Low", "Normal", "High", "Critical blocker"],
    },
    duplicate: {
      type: "score",
      instructions: "How strongly does the NEW issue duplicate any CANDIDATE (same problem, not just same words)? 0=no overlap, 1=exact same issue.",
      criteria: ["No overlap", "Partial overlap", "Exact duplicate"],
    },
  }
}

export interface JevEndpoint {
  url: string
  key: string
}

export function jevEndpointFromEnv(env: NodeJS.ProcessEnv = process.env): JevEndpoint | null {
  if (env.OPENCODE_API_KEY) return { url: JEV_OPENCODE_URL, key: env.OPENCODE_API_KEY }
  const ts = env.TS_API_KEY ?? env.TYPESAFE_API_KEY
  if (ts) return { url: JEV_DIRECT_URL, key: ts }
  return null
}

function num(v: any, fb = 0): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fb
}

/** Call Jev once. Returns null when no key (caller skips semantic triage). */
export async function jevIntake(
  state: IntakeState,
  ep: JevEndpoint | null = jevEndpointFromEnv(),
  fetchFn: typeof fetch = fetch,
): Promise<JevScores | null> {
  if (!ep) return null
  const model = ep.url.includes("opencode.ai") ? JEV_MODEL_OPENCODE : JEV_MODEL
  const res = await fetchFn(ep.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ep.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      state: buildJevState(state),
      questions: buildJevQuestions(state.role),
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(`jev: ${res.status} ${t.slice(0, 300)}`)
  }
  const data = (await res.json()) as any
  const a = data?.answers ?? {}
  const typeAns = a?.type ?? {}
  return {
    repo_fit: num(a?.repo_fit?.noul, 0),
    is_clear: num(a?.is_clear?.score, 0),
    type: typeof typeAns?.choice === "string" ? typeAns.choice : "bug",
    typeConfidence: num(typeAns?.confidence, 0),
    size: num(a?.size?.score, 0),
    priority: num(a?.priority?.score, 0),
    duplicate: num(a?.duplicate?.score, 0),
    duplicateOf: [],
    model: data?.model ?? JEV_MODEL,
  }
}

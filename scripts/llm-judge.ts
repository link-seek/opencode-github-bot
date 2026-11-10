/**
 * LLM-judge baseline for paper eval (#9): one chat call, same 6 outputs as Jev.
 * Talked to via any OpenAI-compatible endpoint. Model comes from ONE variable
 * (LLM_JUDGE_MODEL else OPENCODE_MODEL) in CLI form "provider/id"; API calls
 * split it via model-target.ts (bare id + provider base URL).
 * Only used by replay/eval, never in prod path.
 */
import { parseModelVar } from "./model-target"

export interface JudgeScores {
  repo_fit: number
  is_clear: number
  type: string
  size: number
  priority: number
  duplicate: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

const PROMPT = `You triage GitHub issues. Reply with ONLY a JSON object, no other text.
Fields (all numbers 0-1 except type):
{"repo_fit":0-1,"is_clear":0-1,"type":"bug|feature|docs","size":0-1,"priority":0-1,"duplicate":0-1}
- repo_fit: does it belong to THIS repo? Repo duties: __ROLE__
- is_clear: background + current state + expectation present?
- type: bug, feature or docs?
- size: 0 trivial, 1 must-split large
- priority: 0 low, 1 critical
- duplicate: does it duplicate any CANDIDATE (same problem, not words)?
STATE:
__STATE__`;

function clamp01(v: any): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export async function llmJudge(
  role: string,
  title: string,
  body: string,
  candidates: Array<{ number: number; title: string; summary: string }>,
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JudgeScores> {
  const rawModel = (env.LLM_JUDGE_MODEL || env.OPENCODE_MODEL || "").trim();
  if (!rawModel) throw new Error("need LLM_JUDGE_MODEL or OPENCODE_MODEL");
  const v = parseModelVar(rawModel);
  // Single token (legacy) = bare API id, base from LLM_BASE_URL or gateway default.
  const baseUrl = v.apiBase || (env.LLM_BASE_URL || "").trim() || "https://opencode.ai/inference/openai/v1";
  if (!v.apiId) throw new Error(`empty model id in ${rawModel}`);
  const model = v.apiId;
  const key = env.LLM_API_KEY || env.OPENCODE_API_KEY || "";
  if (!key) throw new Error("need LLM_API_KEY or OPENCODE_API_KEY");
  const state = [`NEW: ${title}\n${body.slice(0, 1500)}`,
    ...candidates.slice(0, 10).map((c) => `#${c.number}: ${c.title} — ${c.summary}`)].join("\n");
  const prompt = PROMPT.replace("__ROLE__", role).replace("__STATE__", state);
  const t0 = Date.now();
  const res = await fetchFn(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`llm-judge: ${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`);
  const data = await res.json().catch(() => {
    throw new Error("llm-judge: non-JSON 2xx response");
  }) as any;
  const text: string = data?.choices?.[0]?.message?.content ?? "{}";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end < start) throw new Error(`llm-judge: no JSON object in response: ${text.slice(0, 200)}`);
  let j: any;
  try {
    j = JSON.parse(text.slice(start, end + 1)) as any;
  } catch (e) {
    throw new Error(`llm-judge: malformed JSON: ${text.slice(0, 200)}`);
  }
  const type = typeof j.type === "string" && ["bug", "feature", "docs"].includes(j.type) ? j.type : "bug";
  return {
    repo_fit: clamp01(j.repo_fit),
    is_clear: clamp01(j.is_clear),
    type,
    size: clamp01(j.size),
    priority: clamp01(j.priority),
    duplicate: clamp01(j.duplicate),
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}

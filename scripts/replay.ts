/**
 * Calibration replay (#9 paper eval): same issues through 3 policies.
 * Usage: bun scripts/replay.ts [--policy keyword|jev|llm|all] [--issues 1,2,3]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, REPLAY_ISSUES, OPENCODE_API_KEY/TS_API_KEY,
 *   LLM_BASE_URL, LLM_API_KEY, LLM_JUDGE_MODEL.
 * Read-only except optional LLM spend (pennies). Prints markdown table to stdout.
 */
import { jevIntake, jevEndpointFromEnv, normalizeScore, SCORE_LEVELS } from "./jev"
import { keywordRecallTopK, type IssueDoc } from "./recall"
import { searchTopCandidates, recallQuery } from "./issue-search"
import { llmJudge } from "./llm-judge"

const token = process.env.GITHUB_TOKEN ?? ""
const repo = process.env.GITHUB_REPOSITORY ?? ""

async function gh(path: string): Promise<any> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  })
  if (!r.ok) throw new Error(`gh ${path}: ${r.status}`)
  return r.json()
}

const role = "opencode-github-bot: action wiring, plugin tools, prompts, docs; reject upstream本体 bugs and user business needs"

async function issueText(n: number) {
  const issue = (await gh(`/repos/${repo}/issues/${n}`)) as any
  if (STRIP) return { title: stripVocab(String(issue.title ?? "")), body: stripVocab(String(issue.body ?? "")) };
  return { title: String(issue.title ?? ""), body: String(issue.body ?? "") }
}

const STRIP_TOKENS = [
  "needs-split", "needs-info", "needs-review", "duplicate", "triage", "intake",
  "pm-", "pm ", "route", "routing", "threshold", "验收标准", "拆分", "分诊",
  "分流", "路由", "阈值", "子 issue", "子issue",
];

function stripVocab(t: string): string {
  let out = ` ${t} `;
  for (const w of STRIP_TOKENS) out = out.split(w).join(" ");
  return out.replace(/\s+/g, " ").trim();
}

const STRIP = process.env.REPLAY_STRIP_VOCAB === "1";

async function runKeyword(n: number, title: string, body: string) {
  const t0 = Date.now()
  let cands: IssueDoc[] = []
  try {
    const found = await searchTopCandidates(repo, recallQuery(title, body), 30, fetch, token)
    cands = found.map((c) => ({ number: c.number, title: c.title, body: c.summary }))
  } catch { /* offline -> empty */ }
  const fresh = { number: n, title, body }
  const top = keywordRecallTopK(fresh, cands.filter((c) => c.number !== n), 10)
  const dup = top.length ? Math.max(...top.map((t) => t.score), 0) : null
  return { route: dup != null && dup >= 0.9 ? "duplicate-close?" : "ready/unknown", dup, ms: Date.now() - t0, cost: 0 }
}

async function runJev(n: number, title: string, body: string) {
  const t0 = Date.now()
  let cands: Array<{ number: number; title: string; summary: string }> = [];
  try {
    const found = await searchTopCandidates(repo, recallQuery(title, body), 30, fetch, token);
    const docs = found.map((c) => ({ number: c.number, title: c.title, body: c.summary }));
    const kwTop = keywordRecallTopK({ number: n, title, body }, docs.filter((d) => d.number !== n), 10);
    const byNum = new Map(docs.map((d) => [d.number, d]));
    cands = kwTop.map((h) => ({ number: h.number, title: byNum.get(h.number)?.title ?? `#${h.number}`, summary: (byNum.get(h.number)?.body ?? "").slice(0, 300) }));
  } catch { /* no candidates -> duplicate unknown */ }
  const out = await jevIntake({ role, freshTitle: title, freshBody: body.slice(0, 1500) }, cands, undefined, fetch).catch((e) => ({ __error: String(e && (e as Error).message || e) }) as any)
  void n
  if (!out || (out as any).__error) return { route: `skip(${(out as any)?.__error ?? 'no-key'})`, dup: null as number | null, ms: Date.now() - t0, cost: 0, s: null as any, det: "" }
  const r = out.repo_fit < 0.5 ? "reject" : out.duplicate != null && out.duplicate >= 0.9 ? "dup-close" : out.duplicate != null && out.duplicate >= 0.7 ? "dup-review" : out.is_clear < 0.5 ? "needs-info" : out.size >= 0.5 ? "split" : "ready";
  const det = `fit=${out.repo_fit.toFixed(2)} clear=${out.is_clear.toFixed(2)} type=${out.type}(${out.typeConfidence.toFixed(2)}) size=${out.size.toFixed(2)} dup=${out.duplicate == null ? "n/a" : `${out.duplicate.toFixed(2)}->[${out.duplicateOf.join(",")}]`} conf=${[out.confidences.is_clear, out.confidences.size, out.confidences.priority].map((c) => c.toFixed(2)).join("/")}`;
  return { route: r, dup: out.duplicate, ms: Date.now() - t0, cost: 0, s: out, det }
}

async function runLlm(n: number, title: string, body: string) {
  const t0 = Date.now()
  try {
    const j = await llmJudge(role, title, body, [], fetch)
    void n
    return {
      route: j.repo_fit < 0.5 ? "reject" : j.duplicate >= 0.9 ? "dup-close" : j.duplicate >= 0.7 ? "dup-review" : j.is_clear < 0.5 ? "needs-info" : j.size >= 0.5 ? "split" : "ready",
      dup: j.duplicate, ms: Date.now() - t0, cost: j.inputTokens + j.outputTokens, s: j,
    }
  } catch (e: any) {
    return { route: `skip(${e.message.slice(0, 60)})`, dup: null as number | null, ms: Date.now() - t0, cost: 0, s: null as any }
  }
}

function flag(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
const policyArg = (flag("--policy") ?? process.env.REPLAY_POLICY ?? "all").split(",")
const nums = ((flag("--issues") ?? process.env.REPLAY_ISSUES ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean))
const policies = policyArg.includes("all") ? (["keyword", "jev", "llm"] as const) : (policyArg as ("keyword" | "jev" | "llm")[])

console.log(`| issue | ${policies.map((p) => `${p} route`).join(" | ")} |`)
console.log(`| --- | ${policies.map(() => "---").join(" | ")} |`)
for (const n of nums) {
  const { title, body } = await issueText(n).catch(() => ({ title: `#${n}`, body: "" }))
  const cells: string[] = []
  for (const p of policies) {
    const r = p === "keyword" ? await runKeyword(n, title, body) : p === "jev" ? await runJev(n, title, body) : await runLlm(n, title, body)
    cells.push(`${r.route} (${r.ms}ms${r.cost ? `, ${r.cost}tok` : ""})${(r as any).det ? ` :: ${(r as any).det}` : ""}`)
  }
  console.log(`| #${n} ${title.slice(0, 40)} | ${cells.join(" | ")} |`)
}
console.log(`\n scoring: normalized 0-1 (jev raw/top-level; llm native 0-1). thresholds: repo<0.5 reject, dup 0.9/0.7, clear<0.5 info, size>=0.5 split.`)
void normalizeScore
void SCORE_LEVELS

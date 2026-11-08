/**
 * Intake orchestrator (#9, no-LLM except Jev).
 * Flow: role -> JS precheck (+exact dup) -> recall? -> Jev? -> route ->
 *   labels + ONE comment (visible template + hidden <!--pm-intake JSON-->).
 * Missing provider/key -> skip that stage (unknown), never block.
 */
import { keywordRecallTopK, semanticRecallTopK, resolveRecallMode, type IssueDoc } from "./recall"
import { cfConfigFromEnv, cfEmbed, cfMintChild, resolveAccountId } from "./cf-recall"
import { jevIntake, type IntakeState } from "./jev"
import { routeIntake, type RouteResult } from "./intake-route"
import { recallQuery, searchTopCandidates } from "./issue-search"

const GH = "https://api.github.com"

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
}

async function gh(path: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GH}${path}`, { ...init, headers: { ...ghHeaders(token), ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`gh ${path}: ${res.status}`)
  if (res.status === 204) return null
  return res.json()
}

export interface RoleFile { accept: string[]; reject: string[]; hard_words?: string[] }

export function loadRole(text: string): RoleFile | null {
  try {
    const accept = [...text.matchAll(/-\s(.+)/g)].map((m) => m[1]).slice(0, 10)
    return { accept, reject: [] }
  } catch { return null }
}

export function hitHardWords(title: string, body: string, words: string[]): string | null {
  const t = `${title}\n${body}`.toLowerCase()
  for (const w of words) if (w && t.includes(w.toLowerCase())) return w
  return null
}

export function visibleComment(decision: string, opts: { linkTo?: number; scores?: string }): string {
  const tail = `\n\n> Auto-triaged by pm-intake. Reply \`reopen\` with more context to request human review.`
  switch (decision) {
    case "needs-info":
      return `Thanks! Please add background + current state + expectation so we can triage (72h window).${tail}`
    case "duplicate-close":
      return `Closing as duplicate of #${opts.linkTo ?? "?"}. If this differs, reply reopen with the difference.${tail}`
    case "duplicate-review":
    case "needs-review":
      return `Flagged for human check.${tail}`
    case "rejected-out-of-scope":
      return `Out of scope for this repo (see README/role).${tail}`
    case "needs-split":
      return `Clear and large — queued for split into sub-issues. Scores: ${opts.scores ?? ""}${tail}`
    default:
      return `Triaged as ready. Scores: ${opts.scores ?? ""}${tail}`
  }
}

export function hiddenMarker(payload: object): string {
  return `<!--pm-intake:${JSON.stringify(payload)}-->`
}

export async function runIntake(env: NodeJS.ProcessEnv = process.env): Promise<RouteResult> {
  const token = env.GITHUB_TOKEN ?? ""
  const repo = env.GITHUB_REPOSITORY ?? ""
  const issueNumber = Number(env.ISSUE_NUMBER ?? 0)
  if (!token || !repo || !issueNumber) throw new Error("need GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER")

  const issue = (await gh(`/repos/${repo}/issues/${issueNumber}`, token)) as any
  const title: string = issue.title ?? ""
  const body: string = issue.body ?? ""

  // 1. role (fail-closed -> needs-human)
  let roleText = ""
  try {
    const f = (await gh(`/repos/${repo}/contents/.github/repo-role.yml?ref=${issue.base ?? "main"}`, token)) as any
    void f
  } catch { /* fall through to raw */ }
  try {
    const r = await fetch(`${GH}/repos/${repo}/contents/.github/repo-role.yml`, { headers: ghHeaders(token) })
    if (r.ok) {
      const j = (await r.json()) as any
      roleText = Buffer.from(j.content, "base64").toString("utf8")
    }
  } catch { /* missing -> needs-human */ }
  if (!roleText) {
    await applyLabels(repo, issueNumber, token, ["needs-human", "needs-role"])
    await postComment(repo, issueNumber, token, `Missing .github/repo-role.yml — parked for human.${hiddenMarker({ v: 1, decision: "needs-human" })}`)
    return { decision: "needs-info", labels: ["needs-human", "needs-role"] }
  }
  const hardWords: string[] = [...roleText.matchAll(/`([^`]+)`/g)].map((m) => m[1]).slice(0, 20)
  const hw = hitHardWords(title, body, hardWords)
  if (hw) {
    const res: RouteResult = { decision: "rejected-out-of-scope", labels: ["rejected-out-of-scope"] }
    await applyLabels(repo, issueNumber, token, res.labels)
    await postComment(repo, issueNumber, token, `${visibleComment("rejected-out-of-scope", {})}\n${hiddenMarker({ v: 1, ...res, hardWord: hw })}`)
    return res
  }

  // 2. JS precheck: empty + exact title dup (same-repo, via search, no AI)
  if (body.trim().length < 20) {
    const res: RouteResult = { decision: "needs-info", labels: ["needs-info"] }
    await applyLabels(repo, issueNumber, token, res.labels)
    await postComment(repo, issueNumber, token, `${visibleComment("needs-info", {})}\n${hiddenMarker({ v: 1, ...res })}`)
    return res
  }
  let exactDup: number | null = null
  try {
    const cands = await searchTopCandidates(repo, title.split(" ").slice(0, 6).join(" "), 10, fetch, token)
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
    const hit = cands.find((c) => c.number !== issueNumber && norm(c.title) === norm(title))
    if (hit) exactDup = hit.number
  } catch { /* search failed -> continue */ }

  // 3. recall (optional): keyword default | cf/custom when configured
  const mode = resolveRecallMode(env)
  let top: Array<{ number: number; score: number }> = []
  let recallNote = "keyword"
  try {
    if (mode === "off") {
      top = []
      recallNote = "off"
    } else if (mode === "cf" || mode === "custom") {
      const cfg = cfConfigFromEnv(env)
      if (!cfg) {
        top = []
        recallNote = "no-cfg-skip"
      } else {
        // Strict: account resolved with parent, data calls ONLY with minted child.
        try { await resolveAccountId(cfg) } catch { /* keep going, mint will fail -> keyword */ }
        const child = await cfMintChild(cfg).catch(() => null)
        if (!child) {
          // Strict: no child -> no CF at all; real keyword fallback, not empty.
          const cands = await searchTopCandidates(repo, recallQuery(title, body), 30, fetch, token)
          const docs: IssueDoc[] = cands.map((c) => ({ number: c.number, title: c.title, body: c.summary }))
          top = keywordRecallTopK({ number: issueNumber, title, body }, docs, 10)
          recallNote = "mint-failed-keyword"
        } else {
          const childCfg = { ...cfg, token: child }
          const cands = await searchTopCandidates(repo, recallQuery(title, body), 30, fetch, token)
          const docs: IssueDoc[] = cands.map((c) => ({ number: c.number, title: c.title, body: c.summary }))
          const vecs = await cfEmbed([`${title}\n${body}`, ...docs.map((d) => `${d.title}\n${d.body ?? ""}`)], childCfg)
          const fq = vecs[0]
          const { vectorCosine } = await import("./recall")
          top = docs
            .map((d, i) => ({ number: d.number, score: vectorCosine(fq, vecs[i + 1]) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
          recallNote = mode
        }
      }
    } else {
      const cands = await searchTopCandidates(repo, recallQuery(title, body), 30, fetch, token)
      const docs: IssueDoc[] = cands.map((c) => ({ number: c.number, title: c.title, body: c.summary }))
      top = keywordRecallTopK({ number: issueNumber, title, body }, docs, 10)
    }
  } catch {
    top = []
    recallNote = "recall-failed-skip"
  }

  // 4. Jev (optional): null key -> all null. Candidates travel as per-record
  // Nouls (docs pattern), so fetch fuller text for top hits only.
  const dupDocs: Array<{ number: number; title: string; summary: string }> = []
  for (const h of top.slice(0, 10)) {
    let t = `#${h.number}`;
    let b = `recall score ${h.score.toFixed(3)}`
    try {
      const full = (await gh(`/repos/${repo}/issues/${h.number}`, token)) as any
      t = String(full.title ?? t)
      b = String(full.body ?? b).replace(/\s+/g, " ").trim().slice(0, 800)
    } catch { /* fall back to recall summary */ }
    dupDocs.push({ number: h.number, title: t, summary: b })
  }
  const state: IntakeState = {
    role: roleText.split("\n").slice(0, 12).join("\n").slice(0, 1500),
    freshTitle: title,
    freshBody: body.slice(0, 3000),
  }
  let scores: any = null
  try {
    scores = await jevIntake(state, dupDocs)
  } catch {
    scores = null
  }

  // 5. route (code, no model)
  const lowConf =
    scores != null &&
    [scores.confidences?.is_clear, scores.confidences?.size, scores.confidences?.priority].some(
      (c) => typeof c === "number" && c < 0.35,
    )
  const dupTop: number | null = scores?.duplicateOf?.[0] ?? null
  const res = routeIntake({
    roleMissing: false,
    repoFit: scores?.repo_fit ?? null,
    emptyTemplate: false,
    exactDupOf: exactDup,
    isClear: scores?.is_clear ?? null,
    size: scores?.size ?? null,
    duplicate: scores?.duplicate ?? null,
    duplicateTop: dupTop,
    typeConfidence: scores?.typeConfidence ?? null,
    lowConfidence: lowConf,
  })
  const scoreStr = scores
    ? `repo_fit=${scores.repo_fit.toFixed(2)} clear=${scores.is_clear.toFixed(2)} size=${scores.size.toFixed(2)} dup=${scores.duplicate == null ? "n/a" : scores.duplicate.toFixed(2)}`
    : `recall=${recallNote}`
  await applyLabels(repo, issueNumber, token, res.labels)
  await postComment(
    repo,
    issueNumber,
    token,
    `${visibleComment(res.decision, { linkTo: res.linkTo, scores: scoreStr })}\n${hiddenMarker({ v: 1, decision: res.decision, labels: res.labels, scores, topK: top, recall: recallNote, model: scores?.model ?? null })}`,
  )
  return res
}

async function applyLabels(repo: string, n: number, token: string, labels: string[]) {
  if (!labels.length) return
  await gh(`/repos/${repo}/issues/${n}/labels`, token, { method: "POST", body: JSON.stringify({ labels }) })
}

async function postComment(repo: string, n: number, token: string, body: string) {
  await gh(`/repos/${repo}/issues/${n}/comments`, token, { method: "POST", body: JSON.stringify({ body }) })
}

if (import.meta.main) {
  const res = await runIntake()
  console.log(JSON.stringify({ decision: res.decision, labels: res.labels }))
}

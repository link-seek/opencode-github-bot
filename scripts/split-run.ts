/**
 * PM split orchestrator (#10): deterministic half of issue splitting.
 * Generation happens in the opencode agent (pm-split skill); this script owns
 * entry gates, plan validation, and all GitHub writes.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER,
 *   SPLIT_ACTION=plan-pre | plan-post | apply
 *   SPLIT_PLAN_PATH (default ./pm-split-plan.json, agent-written)
 *
 * State lives in comments (no external store), mirroring pm-intake:
 *   draft comment carries <!--pm-split-plan:{...}--> for the apply phase.
 */

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
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    throw new Error(`gh ${path}: ${res.status} ${t.slice(0, 300)}`)
  }
  if (res.status === 204) return null
  return res.json()
}

/* ---------------- pure: intake marker ---------------- */

export interface IntakeMarker {
  decision?: string
  labels?: string[]
  scores?: any
}

function lastMarker(body: string, tag: string): string | null {
  // Multiple markers can coexist (quoted old drafts); the LAST complete one wins.
  // Untrusted text elsewhere in the body must not shadow it.
  const re = new RegExp(`<!--${tag}:(\\{.*?\\})-->`, "gs")
  let m: RegExpExecArray | null = null
  let last: string | null = null
  while ((m = re.exec(body)) !== null) last = m[1]
  return last
}

export function parseIntakeMarker(body: string): IntakeMarker | null {
  const raw = lastMarker(body, "pm-intake")
  if (!raw) return null
  try {
    return JSON.parse(raw) as IntakeMarker
  } catch {
    return null
  }
}

/* ---------------- pure: entry gate ---------------- */

export interface EntryOk { ok: true; marker: IntakeMarker }
export interface EntrySkip { ok: false; reason: string }

export function checkEntry(labels: string[], issueBody: string): EntryOk | EntrySkip {
  if (!labels.includes("needs-split")) return { ok: false, reason: "missing needs-split label" }
  const marker = parseIntakeMarker(issueBody ?? "")
  if (!marker) {
    // Marker may live in a bot comment instead; caller retries with comments text.
    return { ok: false, reason: "no pm-intake marker (needs #9 record)" }
  }
  if (marker.decision !== "needs-split")
    return { ok: false, reason: `intake decision is ${marker.decision ?? "unknown"}, not needs-split` }
  return { ok: true, marker }
}

/* ---------------- pure: plan schema ---------------- */

export interface PlanSub {
  title: string
  goal: string
  files: string[]
  acceptance: string[]
  depends_on: number[]
}

export interface SplitPlan {
  verdict: "split" | "reject"
  parent: number
  subs: PlanSub[]
  reason?: string
}

export interface SplitComment {
  body?: string
  user?: { type?: string }
  author_association?: string
}

function isTrusted(c: SplitComment): boolean {
  return c?.user?.type === "Bot" || c?.author_association === "OWNER" || c?.author_association === "MEMBER"
}

/** True when an identical draft (split or reject) was already posted by a trusted author. */
export function isDuplicateDraft(comments: unknown, plan: SplitPlan): boolean {
  try {
    const list: SplitComment[] = Array.isArray(comments) ? (comments as SplitComment[]) : []
    // Normalize both sides through validatePlan so key order/whitespace can't
    // cause false negatives (incoming plans are expected canonical already).
    const norm = validatePlan(JSON.parse(JSON.stringify(plan)), plan.parent)
    if (!norm.ok) return false
    const raw = lastMarker(list.filter(isTrusted).map((c) => String(c.body ?? "")).join("\n"), "pm-split-plan")
    if (!raw) return false
    const pv = validatePlan(JSON.parse(raw), plan.parent)
    return pv.ok && JSON.stringify(pv.plan) === JSON.stringify(norm.plan)
  } catch {
    return false
  }
}

export function validatePlan(raw: any, parent: number): { ok: true; plan: SplitPlan } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "plan is not an object" }
  if (raw.verdict === "reject") {
    if (typeof raw.reason !== "string" || !raw.reason.trim()) return { ok: false, error: "reject needs a reason" }
    if (raw.reason.includes("<!--") || raw.reason.includes("-->"))
      return { ok: false, error: "reject reason must not contain HTML comment markers" }
    if (raw.reason.toLowerCase().includes("approve split"))
      return { ok: false, error: "reject reason must not contain the apply trigger phrase" }
    if (raw.parent != null && raw.parent !== parent)
      return { ok: false, error: `reject plan is for #${JSON.stringify(raw.parent)}, not #${parent}` }
    return { ok: true, plan: { verdict: "reject", parent, subs: [], reason: raw.reason.trim() } }
  }
  if (raw.verdict !== "split") return { ok: false, error: `unknown verdict ${JSON.stringify(raw.verdict)}` }
  if (raw.parent !== parent) return { ok: false, error: `plan is for #${JSON.stringify(raw.parent)}, not #${parent}` }
  if (!Array.isArray(raw.subs)) return { ok: false, error: "subs must be an array" }
  if (raw.subs.length === 0) return { ok: false, error: "subs is empty (reject instead)" }
  if (raw.subs.length > 5) return { ok: false, error: `too many sub-issues (${raw.subs.length} > 5): requirement unclear, reject instead` }
  const n = raw.subs.length
  const subs: PlanSub[] = []
  for (let i = 0; i < n; i++) {
    const s = raw.subs[i]
    const tag = `[Part ${i + 1}/${n}]`
    if (typeof s?.title !== "string" || !s.title.startsWith(tag))
      return { ok: false, error: `subs[${i}].title must start with "${tag}"` }
    if (/[\r\n]/.test(s.title)) return { ok: false, error: `subs[${i}].title must be single-line` }
    if (typeof s?.goal !== "string" || !s.goal.trim()) return { ok: false, error: `subs[${i}] needs a goal` }
    if (!Array.isArray(s?.files)) return { ok: false, error: `subs[${i}].files must be an array` }
    if (!s.files.every((f: unknown) => typeof f === "string" && (f as string).trim()))
      return { ok: false, error: `subs[${i}].files must be non-empty strings` }
    if (s.files.length > 3) return { ok: false, error: `subs[${i}] touches ${s.files.length} files (>3)` }
    if (!Array.isArray(s?.acceptance) || s.acceptance.length === 0 || !s.acceptance.every((a: unknown) => typeof a === "string" && a.trim()))
      return { ok: false, error: `subs[${i}] needs non-empty acceptance criteria` }
    if (!Array.isArray(s?.depends_on) || !s.depends_on.every((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= n && (d as number) !== i + 1))
      return { ok: false, error: `subs[${i}].depends_on must be 1-based indexes into subs (no self-refs)` }
    if (new Set(s.depends_on).size !== s.depends_on.length)
      return { ok: false, error: `subs[${i}].depends_on has duplicates` }
    for (const [k, v] of [["title", s.title], ["goal", s.goal]] as const) {
      const t = String(v)
      if (t.includes("<!--") || t.includes("-->"))
        return { ok: false, error: `subs[${i}].${k} must not contain HTML comment markers` }
      if (t.toLowerCase().includes("approve split"))
        return { ok: false, error: `subs[${i}].${k} must not contain the apply trigger phrase` }
    }
    for (const a of [...(s.acceptance as unknown[]), ...(s.files as unknown[])]) {
      const t = String(a)
      if (t.includes("<!--") || t.includes("-->"))
        return { ok: false, error: `subs[${i}] strings must not contain HTML comment markers` }
      if (t.toLowerCase().includes("approve split"))
        return { ok: false, error: `subs[${i}] strings must not contain the apply trigger phrase` }
    }
    subs.push({ title: s.title, goal: s.goal.trim(), files: s.files, acceptance: s.acceptance.map((a: string) => a.trim()), depends_on: [...s.depends_on].sort((a: number, b: number) => a - b) })
  }
  // Cycle check (Kahn): indegree of j = number of its unprocessed prerequisites.
  const indeg = subs.map((s) => s.depends_on.length)
  const q: number[] = []
  indeg.forEach((d, i) => { if (d === 0) q.push(i) })
  let seen = 0
  while (q.length) {
    const i = q.pop()!
    seen++
    subs.forEach((s, j) => { if (s.depends_on.includes(i + 1) && --indeg[j] === 0) q.push(j) })
  }
  if (seen !== n) return { ok: false, error: "depends_on contains a cycle" }
  return { ok: true, plan: { verdict: "split", parent, subs } }
}

/* ---------------- pure: rendering ---------------- */

export function splitPlanMarker(plan: SplitPlan): string {
  return `<!--pm-split-plan:${JSON.stringify(plan)}-->`
}

export function parseSplitPlanMarker(body: string): SplitPlan | null {
  // Last complete marker wins — the draft comment embeds untrusted text
  // (parent title, criteria) that must not shadow it.
  const raw = lastMarker(body, "pm-split-plan")
  if (!raw) return null
  try {
    return JSON.parse(raw) as SplitPlan
  } catch {
    return null
  }
}

/** Untrusted titles must not break markdown structure or the trailing marker. */
export function sanitizeTitle(t: string): string {
  return String(t ?? "").replace(/[\r\n]+/g, " ").trim()
}

function tableCell(t: string): string {
  return sanitizeTitle(t).replace(/\|/g, "/")
}

export function renderDraft(plan: SplitPlan, parentTitleRaw: string): string {
  const parentTitle = sanitizeTitle(parentTitleRaw)
  const rows = plan.subs
    .map((s, i) => `| ${i + 1} | ${tableCell(s.title.replace(/^\[Part \d+\/\d+\] /, ""))} | ${tableCell(s.files.join(", ") || "—")} | ${s.depends_on.length ? s.depends_on.map((d) => `Part ${d}`).join(", ") : "无"} |`)
    .join("\n")
  const criteria = plan.subs
    .map((s, i) => `**Part ${i + 1} 验收**：\n${s.acceptance.map((a) => `- [ ] ${a}`).join("\n")}`)
    .join("\n\n")
  return [
    `Split draft for #${plan.parent} “${parentTitle}” (${plan.subs.length} sub-issues):`,
    ``,
    `| # | 目标 | 文件 | 依赖 |`,
    `| - | ---- | ---- | ---- |`,
    rows,
    ``,
    criteria,
    ``,
    `> To approve, post a comment with the word "approve", a space, then the word "split", on a single line (OWNER/MEMBER only). Granularity: 1 sub-issue = one finish-fix run (≤3 files, max 5 subs).`,
    splitPlanMarker(plan),
  ].join("\n")
}

export function renderSubIssueBody(s: PlanSub, _idx: number, parentNum: number, parentTitleRaw: string): string {
  const parentTitle = sanitizeTitle(parentTitleRaw)
  const deps = s.depends_on.length
    ? s.depends_on.map((d) => `Part ${d}（先合）`).join("、")
    : "无"
  return [
    `Part of #${parentNum}: ${parentTitle}`,
    ``,
    `## 背景`,
    s.goal,
    ``,
    `## 改动点`,
    ...s.files.map((f) => `- \`${f}\``),
    ...(s.files.length ? [] : ["- （配置/文档类改动，见目标描述）"]),
    ``,
    `## 验收标准`,
    ...s.acceptance.map((a) => `- [ ] ${a}`),
    ``,
    `## 依赖`,
    deps,
    ``,
    `<!--pm-split-part:${parentNum}-->`,
  ].join("\n")
}

export function renderParentSplitSection(children: Array<{ number: number; title: string }>): string {
  return ["## Split into", ...children.map((c) => `- [ ] #${c.number} ${c.title}`)].join("\n")
}

/* ---------------- io ---------------- */

export function recordPath(): string {
  return `${process.cwd()}/pm-split-records.jsonl`
}

async function appendRecord(row: Record<string, unknown>): Promise<void> {
  try {
    const fs = await import("node:fs")
    await fs.promises.appendFile(recordPath(), JSON.stringify(row) + "\n", "utf8")
  } catch { /* logging must never break triage */ }
}

async function applyLabels(repo: string, n: number, token: string, labels: string[]) {
  // Fully best-effort (unknown label, no label-admin 404/403, rate limit):
  // labels are advisory; comments carry the state. Warn and continue.
  if (!labels.length) return
  try {
    await gh(`/repos/${repo}/issues/${n}/labels`, token, { method: "POST", body: JSON.stringify({ labels }) })
  } catch (e) {
    console.log(`applyLabels skipped (${labels.join(",")}): ${String((e as Error)?.message ?? e).slice(0, 200)}`)
  }
}

async function removeLabel(repo: string, n: number, token: string, label: string) {
  await gh(`/repos/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`, token, { method: "DELETE" }).catch(() => null)
}

async function postComment(repo: string, n: number, token: string, body: string) {
  await gh(`/repos/${repo}/issues/${n}/comments`, token, { method: "POST", body: JSON.stringify({ body }) })
}

export async function findSplitPlan(comments: Array<{ body?: string; user?: { type?: string }; author_association?: string }>): Promise<SplitPlan | null> {
  // Only trust markers from automation or maintainers: a forged marker in a
  // random user's comment must not become an approved plan.
  // Prefer the bot-authored draft; fall back to OWNER/MEMBER-authored markers
  // (dogfood posts via owner PAT, not a bot token).
  const trusted = (c: { user?: { type?: string }; author_association?: string }) =>
    c.user?.type === "Bot" || c.author_association === "OWNER" || c.author_association === "MEMBER"
  for (let pass = 0; pass < 2; pass++) {
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i]
      if (!trusted(c)) continue
      if (pass === 0 && c.user?.type !== "Bot") continue
      const p = parseSplitPlanMarker(c.body ?? "")
      if (p && p.verdict === "split") return p
    }
  }
  return null
}

export function findMarkerInComments(
  comments: Array<{ body?: string; user?: { type?: string }; author_association?: string }>,
): IntakeMarker | null {
  const trusted = (c: { user?: { type?: string }; author_association?: string }) =>
    c.user?.type === "Bot" || c.author_association === "OWNER" || c.author_association === "MEMBER"
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!trusted(comments[i])) continue
    const m = parseIntakeMarker(comments[i].body ?? "")
    if (m) return m
  }
  return null
}

const SPLIT_LABELS: Record<string, string> = {
  "split-proposed": "fbca04",
  "split-applied": "0e8a16",
  "needs-triage": "ededed",
}

/** Labels are advisory; state lives in comments. Never let label admin fail the run. */
async function ensureLabels(repo: string, token: string, names: string[]) {
  for (const name of names) {
    await gh(`/repos/${repo}/labels`, token, {
      method: "POST",
      body: JSON.stringify({ name, color: SPLIT_LABELS[name] ?? "ededed" }),
    }).catch((e) => {
      console.log(`ensureLabels skipped ${name}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    })
  }
}

async function findExistingChild(repo: string, token: string, title: string, parent: number): Promise<number | null> {
  // Idempotency: reuse an open issue with the same title that already points at the parent.
  // Title is matched client-side (never interpolated into the search query).
  // Search is retried (transient rate limits); sustained failure proceeds as
  // no-match with a loud log line rather than aborting a half-done apply.
  const q = encodeURIComponent(`repo:${repo} "Part of #${parent}" in:body state:open`)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await gh(`/search/issues?q=${q}&per_page=100`, token)) as any
      const items = (res?.items ?? []) as Array<{ number: number; title?: string; body?: string }>
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
      const hit = items.find((it) => norm(it.title ?? "") === norm(title) && (it.body ?? "").includes(`Part of #${parent}`))
      return hit ? hit.number : null
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
  console.log(`search unavailable after retries, proceeding without dedup: ${String((lastErr as Error)?.message ?? lastErr)}`)
  return null
}

/** Topologically ordered indexes (dependencies first). */
export function topoOrder(subs: PlanSub[]): number[] {
  const n = subs.length
  const indeg = subs.map((s) => s.depends_on.length)
  const dependents: number[][] = subs.map(() => [])
  subs.forEach((s, j) => s.depends_on.forEach((d) => { dependents[d - 1].push(j) }))
  const q: number[] = []
  indeg.forEach((d, i) => { if (d === 0) q.push(i) })
  const order: number[] = []
  while (q.length) {
    const i = q.shift()!
    order.push(i)
    for (const j of dependents[i]) if (--indeg[j] === 0) q.push(j)
  }
  return order
}

/* ---------------- main ---------------- */

async function runPlanPre(env: NodeJS.ProcessEnv): Promise<void> {
  const token = env.GITHUB_TOKEN ?? ""
  const repo = env.GITHUB_REPOSITORY ?? ""
  const n = Number(env.ISSUE_NUMBER ?? 0)
  if (!token || !repo || !n) throw new Error("need GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER")
  const issue = (await gh(`/repos/${repo}/issues/${n}`, token)) as any
  const labels: string[] = (issue.labels ?? []).map((l: any) => l.name)
  let entry = checkEntry(labels, String(issue.body ?? ""))
  let marker = entry.ok ? (entry as EntryOk).marker : null
  if (!entry.ok && (entry as EntrySkip).reason.includes("no pm-intake marker")) {
    const comments = (await gh(`/repos/${repo}/issues/${n}/comments?per_page=100`, token)) as any[]
    marker = findMarkerInComments(comments)
    if (marker && marker.decision === "needs-split") entry = { ok: true, marker }
  }
  if (!entry.ok) {
    console.log(`split-plan skipped: ${(entry as EntrySkip).reason}`)
    return
  }
  const comments = (await gh(`/repos/${repo}/issues/${n}/comments?per_page=20`, token)) as any[]
  const ctx = [
    `# Split context: #${n} ${String(issue.title ?? "")}`,
    ``,
    `## Parent issue`,
    `===== BEGIN ISSUE #${n} =====`,
    String(issue.body ?? "(no body)"),
    `===== END ISSUE #${n} =====`,
    ``,
    `## #9 triage record`,
    "```json",
    JSON.stringify(marker, null, 1),
    "```",
    ``,
    `## Recent comments (latest 5)`,
    ...comments.slice(-5).map((c: any) => `### @${c.user?.login}\n${String(c.body ?? "").slice(0, 1500)}`),
    ``,
    `## Output contract`,
    `Write pm-split-plan.json in the current directory per the pm-split skill. Do NOT comment or create issues.`,
  ].join("\n")
  const fs = await import("node:fs")
  await fs.promises.mkdir(".opencode", { recursive: true })
  await fs.promises.writeFile(".opencode/split-context.md", ctx, "utf8")
  console.log(`split context written for #${n}`)
}

async function runPlanPost(env: NodeJS.ProcessEnv): Promise<void> {
  const token = env.GITHUB_TOKEN ?? ""
  const repo = env.GITHUB_REPOSITORY ?? ""
  const n = Number(env.ISSUE_NUMBER ?? 0)
  if (!token || !repo || !n) throw new Error("need GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER")
  const fs = await import("node:fs")
  const raw = await fs.promises.readFile(env.SPLIT_PLAN_PATH || "pm-split-plan.json", "utf8").catch(() => "")
  let parsed: any = null
  try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
  const v = validatePlan(parsed, n)
  if (!v.ok) {
    await postComment(repo, n, token, `Split plan invalid, needs a human rethink:\n\n\`${v.error}\``)
    await appendRecord({ v: 1, ts: new Date().toISOString(), repo, issue: n, phase: "plan", ok: false, error: v.error })
    throw new Error(`invalid split plan: ${v.error}`)
  }
  if (v.plan.verdict === "reject") {
    await postComment(repo, n, token, `Split rejected by planner, staying whole for now:\n\n${v.plan.reason}\n\n> Reply with more context and re-run split when ready.`)
    await appendRecord({ v: 1, ts: new Date().toISOString(), repo, issue: n, phase: "plan", ok: true, verdict: "reject" })
    return
  }
  const issue = (await gh(`/repos/${repo}/issues/${n}`, token)) as any
  const rawComments: unknown = await gh(`/repos/${repo}/issues/${n}/comments?per_page=100`, token).catch((e) => {
    console.log(`plan-post comments fetch failed, dedup skipped: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    return []
  })
  const priorComments: SplitComment[] = Array.isArray(rawComments) ? (rawComments as SplitComment[]) : []
  // Dedup: skip reposting an identical draft already posted by a trusted author.
  if (isDuplicateDraft(priorComments, v.plan)) {
    console.log("identical draft already posted, skipping duplicate")
    return
  }
  await postComment(repo, n, token, renderDraft(v.plan, String(issue.title ?? "")))
  await ensureLabels(repo, token, ["split-proposed"])
  await applyLabels(repo, n, token, ["split-proposed"])
  await appendRecord({ v: 1, ts: new Date().toISOString(), repo, issue: n, phase: "plan", ok: true, verdict: "split", subs: v.plan.subs.length })
  await fs.promises.unlink(env.SPLIT_PLAN_PATH || "pm-split-plan.json").catch(() => null)
}

async function runApply(env: NodeJS.ProcessEnv): Promise<void> {
  const token = env.GITHUB_TOKEN ?? ""
  const repo = env.GITHUB_REPOSITORY ?? ""
  const n = Number(env.ISSUE_NUMBER ?? 0)
  if (!token || !repo || !n) throw new Error("need GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER")
  const issue = (await gh(`/repos/${repo}/issues/${n}`, token)) as any
  const labels: string[] = (issue.labels ?? []).map((l: any) => l.name)
  if (labels.includes("split-applied")) {
    console.log("split already applied, nothing to do")
    return
  }
  const commentsRaw: unknown = await gh(`/repos/${repo}/issues/${n}/comments?per_page=100`, token).catch((e) => {
    console.log(`apply comments fetch failed, proceeding without dedup: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    return []
  })
  const comments: SplitComment[] = Array.isArray(commentsRaw) ? (commentsRaw as SplitComment[]) : []
  const hasDraft = (await findSplitPlan(comments)) != null
  if (!labels.includes("split-proposed") && !hasDraft) {
    console.log("no split-proposed label and no approved draft, nothing to do (need human-approved draft first)")
    return
  }
  const plan = await findSplitPlan(comments)
  if (!plan) {
    console.log("no approved split plan found in comments")
    return
  }
  const v = validatePlan(plan, n)
  if (!v.ok || v.plan.verdict !== "split") throw new Error(`approved plan invalid: ${!v.ok ? (v as any).error : "rejected"}`)
  const parentTitle = String(issue.title ?? "")
  await ensureLabels(repo, token, ["split-applied"])
  // needs-triage is best-effort: some tokens cannot create labels. Sub-issues
  // are still usable without it (they link back via "Part of #N").
  await ensureLabels(repo, token, ["needs-triage"]).catch((e) => {
    console.log(`needs-triage label unavailable, continuing unlabeled: ${String((e as Error)?.message ?? e)}`)
  })
  const created: Array<{ number: number; title: string }> = []
  try {
    for (const idx of topoOrder(v.plan.subs)) {
      const s = v.plan.subs[idx]
      const existing = await findExistingChild(repo, token, s.title, n)
      if (existing != null) {
        created.push({ number: existing, title: s.title })
        console.log(`reuse existing #${existing} for "${s.title}"`)
        continue
      }
      const body = renderSubIssueBody(s, idx, n, parentTitle)
      let created_issue: any = null
      try {
        created_issue = await gh(`/repos/${repo}/issues`, token, {
          method: "POST",
          body: JSON.stringify({ title: s.title, body, labels: ["needs-triage"] }),
        })
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        // Retry bare only on label validation failures (422 mentioning labels);
        // anything else (auth, rate limit, abuse) must fail loudly.
        if (!/ 422[\s:]/.test(msg) || !/label/i.test(msg)) throw e
        console.log(`label attach failed, creating unlabeled: ${msg.slice(0, 200)}`)
        created_issue = await gh(`/repos/${repo}/issues`, token, {
          method: "POST",
          body: JSON.stringify({ title: s.title, body }),
        })
      }
      created.push({ number: created_issue.number, title: s.title })
    }
  } catch (e) {
    // Partial progress must not be silent: human re-runs apply (dedup via title match).
    if (created.length) {
      await postComment(
        repo, n, token,
        [`Split partially applied before failure (${created.map((c) => `#${c.number}`).join(", ")}):`, String((e as Error)?.message ?? e), "Re-run approve to resume; existing children are reused."].join("\n"),
      ).catch(() => null)
    }
    throw e
  }
  // created[] stays in topo (dependency) order for the tasklist and summary.
  const body: string = String(issue.body ?? "")
  if (!body.includes("## Split into")) {
    await gh(`/repos/${repo}/issues/${n}`, token, {
      method: "PATCH",
      body: JSON.stringify({ body: `${body.trim()}\n\n${renderParentSplitSection(created)}` }),
    })
  }
  await removeLabel(repo, n, token, "split-proposed").catch(() => null)
  await applyLabels(repo, n, token, ["split-applied"])
  await postComment(
    repo, n, token,
    [
      `Split applied: ${created.map((c) => `#${c.number}`).join(", ")}`,
      ...created.map((c) => `- #${c.number} ${c.title}`),
    ].join("\n"),
  )
  await appendRecord({ v: 1, ts: new Date().toISOString(), repo, issue: n, phase: "apply", ok: true, children: created.map((c) => c.number) })
}

if (import.meta.main) {
  const action = process.env.SPLIT_ACTION ?? "plan-pre"
  const run = action === "plan-post" ? runPlanPost : action === "apply" ? runApply : runPlanPre
  await run(process.env).catch((e) => {
    console.error(String((e as Error)?.message ?? e))
    process.exit(1)
  })
}

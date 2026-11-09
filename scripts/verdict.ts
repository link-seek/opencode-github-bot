/**
 * Human-verdict recorder (#9 paper eval).
 * Triggered by human issue events (labeled/unlabeled/closed/reopened/edited).
 * Compares the bot's last pm-intake decision (hidden JSON comment) against
 * current human-driven state and records: agree | override | unclear.
 * Read-only + artifact upload. Never comments.
 */

const GH = "https://api.github.com"

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

async function gh(path: string, token: string): Promise<any> {
  const res = await fetch(`${GH}${path}`, { headers: headers(token) })
  if (!res.ok) throw new Error(`gh ${path}: ${res.status}`)
  return res.json()
}

export interface Verdict {
  v: 1
  ts: string
  repo: string
  issue: number
  event: string
  actor: string
  botDecision: string | null
  botLabels: string[]
  nowLabels: string[]
  nowState: string
  verdict: "agree" | "override" | "unclear"
  reason: string
}

const ROUTE = ["ready", "needs-split", "needs-review", "needs-info", "rejected-out-of-scope", "duplicate"]

export function classifyVerdict(bot: { decision: string | null; labels: string[] }, now: { labels: string[]; state: string; event: string }): Omit<Verdict, "v" | "ts" | "repo" | "issue" | "event" | "actor"> {
  const botRoute = new Set(bot.labels.filter((l) => ROUTE.includes(l)))
  const nowRoute = new Set(now.labels.filter((l) => ROUTE.includes(l)))
  const sameRoute = botRoute.size === nowRoute.size && [...botRoute].every((l) => nowRoute.has(l))

  // Human reopened something the bot closed/rejected -> override.
  if ((bot.decision === "duplicate-close" || bot.decision === "rejected-out-of-scope") && now.state === "open") {
    return { botDecision: bot.decision, botLabels: bot.labels, nowLabels: now.labels, nowState: now.state, verdict: "override", reason: "human reopened bot-closed issue" }
  }
  // Human completed something the bot routed to work -> agree.
  if ((bot.decision === "ready" || bot.decision === "needs-split") && now.state === "closed") {
    return { botDecision: bot.decision, botLabels: bot.labels, nowLabels: now.labels, nowState: now.state, verdict: "agree", reason: "human completed bot-routed issue" }
  }
  // Human changed the routing labels -> override.
  if (!sameRoute) {
    return { botDecision: bot.decision, botLabels: bot.labels, nowLabels: now.labels, nowState: now.state, verdict: "override", reason: "human changed route labels" }
  }
  // Human touched it but routing stands (e.g. added info after needs-info) -> unclear/expected flow.
  if (now.event === "edited" || now.event === "labeled") {
    return { botDecision: bot.decision, botLabels: bot.labels, nowLabels: now.labels, nowState: now.state, verdict: "unclear", reason: "human activity, route unchanged" }
  }
  return { botDecision: bot.decision, botLabels: bot.labels, nowLabels: now.labels, nowState: now.state, verdict: "unclear", reason: "no routing signal" }
}

export function parseMarker(body: string): { decision: string; labels: string[] } | null {
  const m = body.match(/<!--pm-intake:(\{.*?\})-->/s)
  if (!m) return null
  try {
    const d = JSON.parse(m[1]) as any
    return { decision: String(d.decision ?? ""), labels: Array.isArray(d.labels) ? d.labels.map(String) : [] }
  } catch {
    return null
  }
}

export async function runVerdict(env: NodeJS.ProcessEnv = process.env): Promise<Verdict | null> {
  const token = env.GITHUB_TOKEN ?? ""
  const repo = env.GITHUB_REPOSITORY ?? ""
  const issueNumber = Number(env.ISSUE_NUMBER ?? 0)
  const event = env.VERDICT_EVENT ?? ""
  const actor = env.VERDICT_ACTOR ?? ""
  if (!token || !repo || !issueNumber || !actor) throw new Error("need GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_NUMBER, VERDICT_ACTOR")
  if (actor.endsWith("[bot]")) return null // ignore bot's own events

  const issue = (await gh(`/repos/${repo}/issues/${issueNumber}`, token)) as any
  const nowLabels: string[] = ((issue.labels ?? []) as any[]).map((l) => (typeof l === "string" ? l : l.name))
  const nowState: string = issue.state ?? "open"

  const comments = (await gh(`/repos/${repo}/issues/${issueNumber}/comments?per_page=100`, token)) as any[]
  let bot: { decision: string; labels: string[] } | null = null
  for (let i = comments.length - 1; i >= 0; i--) {
    const login = comments[i]?.user?.login ?? ""
    if (!login.endsWith("[bot]") && login !== "github-actions[bot]") continue
    const p = parseMarker(String(comments[i]?.body ?? ""))
    if (p && p.decision) {
      bot = p
      break
    }
  }

  const row: Verdict = {
    v: 1,
    ts: new Date().toISOString(),
    repo,
    issue: issueNumber,
    event,
    actor,
    ...classifyVerdict(
      { decision: bot?.decision ?? null, labels: bot?.labels ?? [] },
      { labels: nowLabels, state: nowState, event },
    ),
  }

  try {
    const fs = await import("node:fs")
    await fs.promises.appendFile(`${process.cwd()}/pm-verdicts.jsonl`, JSON.stringify(row) + "\n", "utf8")
  } catch { /* never break on logging */ }
  return row
}

if (import.meta.main) {
  const row = await runVerdict()
  console.log(JSON.stringify(row ?? { skipped: "bot actor or missing env" }))
}

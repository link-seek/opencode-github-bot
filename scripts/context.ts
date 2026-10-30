/**
 * Context assembly helpers for the GitHub bot.
 * Mirrors the GraphQL/REST gathering from OpenHands pr-review (agent_script.py)
 * and link-seek/issue-resolver (fix.yml).
 */

const GITHUB_API = "https://api.github.com"

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

export async function fetchPRFiles(prNumber: number): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY
  const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${prNumber}/files`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`files: ${res.status}`)
  const files = (await res.json()) as Array<{ filename: string; patch?: string; status: string }>
  const lines: string[] = []
  let total = 0
  const MAX_TOTAL = 100_000
  const MAX_PER_FILE = 8_000
  for (const f of files) {
    const patch = f.patch ?? ""
    const trimmed = patch.length > MAX_PER_FILE ? patch.slice(0, MAX_PER_FILE) + "\n[patch abbreviated]" : patch
    if (total + trimmed.length > MAX_TOTAL) {
      lines.push(`### ${f.status}: ${f.filename}\n[patch omitted: budget exceeded]`)
      continue
    }
    total += trimmed.length
    lines.push(`### ${f.status}: ${f.filename}\n\`\`\`diff\n${trimmed}\n\`\`\``)
  }
  return lines.join("\n\n")
}

export async function fetchIssueContext(issueNumber: number): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`issue: ${res.status}`)
  const data = (await res.json()) as { title: string; body: string; user: { login: string } }
  return `## Issue #${issueNumber}: ${data.title}\nAuthor: ${data.user.login}\n\n${data.body ?? ""}`
}

export async function fetchPRContext(prNumber: number): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY
  const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${prNumber}`, {
    headers: headers(),
  })
  if (!res.ok) throw new Error(`pr: ${res.status}`)
  const data = (await res.json()) as {
    title: string
    body: string
    base: { ref: string }
    head: { ref: string; sha: string }
    user: { login: string }
  }
  return [
    `## PR #${prNumber}: ${data.title}`,
    `Author: ${data.user.login}`,
    `Base: ${data.base.ref}  Head: ${data.head.ref}  SHA: ${data.head.sha}`,
    "",
    data.body ?? "",
  ].join("\n")
}

export async function fetchReviewThreads(prNumber: number): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY
  const [owner, name] = repo!.split("/")
  const query = `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(last:50){nodes{id isResolved path line comments(first:20){nodes{author{login}body createdAt}}}}}}}`
  const res = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { owner, repo: name, pr: prNumber } }),
  })
  if (!res.ok) throw new Error(`graphql: ${res.status}`)
  const data = (await res.json()) as any
  const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
  const lines: string[] = []
  for (const t of threads) {
    if (t.isResolved) continue
    lines.push(`### ${t.path}:${t.line ?? "?"}`)
    for (const c of t.comments?.nodes ?? []) {
      lines.push(`- @${c.author?.login}: ${c.body}`)
    }
  }
  return lines.join("\n")
}
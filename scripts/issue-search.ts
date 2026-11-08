/**
 * Candidate prefilter (#9): GitHub search top30 (keyword, no embedding).
 * Keeps Jev state within 64k/32k. Pure search, no AI.
 */
export interface SearchDoc { number: number; title: string; summary: string }

const STOP = new Set(
  "for,the,and,or,to,of,a,an,in,on,is,it,this,that,with,add,加,的".split(","),
)

/** Build an OR keyword query from title+body (recall prefilter). */
export function recallQuery(title: string, body: string): string {
  const toks = `${title} ${body}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
  // GitHub search allows at most 5 AND/OR/NOT operators: cap at 5 terms.
  const uniq = [...new Set(toks)].sort((a, b) => b.length - a.length).slice(0, 5)
  return uniq.join(" OR ")
}

export async function searchTopCandidates(
  repo: string,
  query: string,
  k = 30,
  fetchFn: typeof fetch = fetch,
  token?: string,
): Promise<SearchDoc[]> {
  const q = `repo:${repo} ${query} in:title,body`.slice(0, 256)
  const res = await fetchFn(
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${k}&sort=updated&order=desc`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  )
  if (!res.ok) throw new Error(`search: ${res.status}`)
  const data = (await res.json()) as any
  return ((data?.items ?? []) as any[]).map((i) => ({
    number: i.number,
    title: i.title ?? "",
    summary: (i.body ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
  }))
}

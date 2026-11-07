/**
 * Candidate prefilter (#9): GitHub search top30 (keyword, no embedding).
 * Keeps Jev state within 64k/32k. Pure search, no AI.
 */
export interface SearchDoc { number: number; title: string; summary: string }

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

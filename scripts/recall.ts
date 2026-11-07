/**
 * Recall provider for intake dedup (#9).
 * Contract: optional semantic recall. No provider configured -> skip (unknown),
 * downstream proceeds without duplicate info. Title exact-match stays in JS.
 *
 * Backends:
 *  - off: always [] (duplicate unknown)
 *  - keyword (default, zero-dep): in-memory TF-IDF cosine over title+body
 *  - custom: caller-supplied embed(url, texts) -> vectors, cosine in memory.
 *    Vector DB address optional: if given, candidates are pre-filtered by it;
 *    otherwise all candidates are scored in memory (fine for <1k issues).
 *  - cf: preset of custom (Workers AI bge-m3 + Vectorize). Same interface,
 *    only endpoint/headers differ. No auto-deploy; bring your own account.
 */

export interface IssueDoc {
  number: number
  title: string
  body?: string
}

export interface RecallHit {
  number: number
  score: number
}

export type RecallMode = "off" | "keyword" | "custom" | "cf"

export function resolveRecallMode(env: NodeJS.ProcessEnv = process.env): RecallMode {
  const m = (env.RECALL_MODE ?? "keyword").toLowerCase()
  if (m === "off" || m === "keyword" || m === "custom" || m === "cf") return m
  return "keyword"
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function tf(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1)
  const n = tokens.length || 1
  for (const [k, v] of m) m.set(k, v / n)
  return m
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0)
  let na = 0
  for (const v of a.values()) na += v * v
  let nb = 0
  for (const v of b.values()) nb += v * v
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function docText(d: IssueDoc): string {
  return `${d.title}\n${d.body ?? ""}`
}

/** keyword backend: TF-IDF-ish cosine (idf skipped for scale; tf cosine is enough <1k docs). */
export function keywordRecallTopK(
  fresh: IssueDoc,
  candidates: IssueDoc[],
  k = 10,
): RecallHit[] {
  const fq = tf(tokenize(docText(fresh)))
  return candidates
    .filter((c) => c.number !== fresh.number)
    .map((c) => ({ number: c.number, score: cosine(fq, tf(tokenize(docText(c)))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** cosine for float vectors (custom/cf backends share it). */
export function vectorCosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>

/** generic semantic recall: embed fresh + candidates, cosine in memory. */
export async function semanticRecallTopK(
  fresh: IssueDoc,
  candidates: IssueDoc[],
  k: number,
  embed: EmbedFn,
): Promise<RecallHit[]> {
  const docs = candidates.filter((c) => c.number !== fresh.number)
  if (docs.length === 0) return []
  const vecs = await embed([docText(fresh), ...docs.map(docText)])
  const [fq, ...rest] = vecs
  return docs
    .map((c, i) => ({ number: c.number, score: vectorCosine(fq, rest[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Truncate one doc for Jev state budget. */
export function oneLine(s: string, max = 200): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length <= max ? t : t.slice(0, max) + "…"
}

/** Build Jev state: fresh full + candidate summaries. Caller caps count for 64k/32k. */
export function buildRecallState(
  fresh: IssueDoc,
  candidates: IssueDoc[],
  hits: RecallHit[],
  perDocMax = 200,
): string {
  const byNum = new Map(candidates.map((c) => [c.number, c]))
  const lines = hits
    .map((h) => byNum.get(h.number))
    .filter(Boolean)
    .map((c) => `#${c!.number}: ${oneLine(c!.title, perDocMax)} — ${oneLine(c!.body ?? "", perDocMax)} (score ${hits.find((h) => h.number === c!.number)!.score.toFixed(3)})`)
  return [
    `NEW: #${fresh.number}: ${fresh.title}\n${fresh.body ?? ""}`,
    `CANDIDATES:`,
    ...lines,
  ].join("\n")
}

import { describe, expect, test } from "bun:test"
import {
  keywordRecallTopK,
  vectorCosine,
  semanticRecallTopK,
  buildRecallState,
  resolveRecallMode,
  type IssueDoc,
} from "../scripts/recall"

const docs: IssueDoc[] = [
  { number: 1, title: "fix: resolve issue #12", body: "commit and push branch" },
  { number: 2, title: "fix: resolve issue #12", body: "commit and push branch" },
  { number: 3, title: "docs: update README", body: "add usage section" },
  { number: 4, title: "feat: add Jev triage", body: "classify issues with Jev model" },
]

describe("resolveRecallMode", () => {
  test("defaults to keyword", () => {
    expect(resolveRecallMode({} as any)).toBe("keyword")
  })
  test("off disables recall", () => {
    expect(resolveRecallMode({ RECALL_MODE: "off" } as any)).toBe("off")
  })
})

describe("keywordRecallTopK", () => {
  test("exact duplicate ranks first with score 1", () => {
    const hits = keywordRecallTopK(docs[0], docs, 10)
    expect(hits[0].number).toBe(2)
    expect(hits[0].score).toBeCloseTo(1, 5)
  })
  test("excludes self", () => {
    const hits = keywordRecallTopK(docs[0], docs, 10)
    expect(hits.every((h) => h.number !== 1)).toBe(true)
  })
  test("deterministic: same input same order", () => {
    const a = keywordRecallTopK(docs[3], docs, 3)
    const b = keywordRecallTopK(docs[3], docs, 3)
    expect(a).toEqual(b)
  })
})

describe("semanticRecallTopK", () => {
  test("uses provided embed fn, no network", async () => {
    const fakeEmbed = async (texts: string[]) =>
      texts.map((t) => (t.includes("Jev") ? [1, 0] : [0, 1]))
    const fresh: IssueDoc = { number: 9, title: "Jev triage broken", body: "jev" }
    const hits = await semanticRecallTopK(fresh, docs, 2, fakeEmbed)
    expect(hits[0].number).toBe(4)
  })
  test("empty candidates -> []", async () => {
    const hits = await semanticRecallTopK(docs[0], [], 10, async () => [])
    expect(hits).toEqual([])
  })
})

describe("buildRecallState", () => {
  test("contains new issue + candidate summaries with scores", () => {
    const hits = keywordRecallTopK(docs[0], docs, 2)
    const s = buildRecallState(docs[0], docs, hits, 50)
    expect(s).toContain("NEW: #1")
    expect(s).toContain("#2:")
    expect(s.length).toBeLessThan(2000)
  })
})

describe("vectorCosine", () => {
  test("orthogonal -> 0, identical -> 1", () => {
    expect(vectorCosine([1, 0], [0, 1])).toBe(0)
    expect(vectorCosine([1, 2], [1, 2])).toBeCloseTo(1, 5)
  })
})

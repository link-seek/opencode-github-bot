import { describe, expect, test } from "bun:test"
import {
  buildJevQuestions,
  buildJevState,
  DEFAULT_JEV_MODEL,
  DIRECT_JEV_URL,
  jevEndpointFromEnv,
  jevIntake,
  normalizeScore,
  OPENCODE_JEV_URL,
  resolveJevTarget,
  SCORE_LEVELS,
} from "../scripts/jev"

describe("normalizeScore", () => {
  test("0-2 scale maps to 0-1", () => {
    expect(normalizeScore(1.43, 3)).toBeCloseTo(0.715, 3)
    expect(normalizeScore(0, 3)).toBe(0)
    expect(normalizeScore(2, 3)).toBe(1)
  })
  test("clamps out of range", () => {
    expect(normalizeScore(9, 4)).toBe(1)
    expect(normalizeScore(-1, 4)).toBe(0)
  })
})

describe("jev contract (docs-aligned)", () => {
  test("defaults pinned: opencode gateway + jev-1.13", () => {
    expect(DEFAULT_JEV_MODEL).toBe("jev-1.13")
    expect(OPENCODE_JEV_URL).toContain("opencode.ai")
    const q = buildJevQuestions("duty", [])
    expect(Object.keys(q).sort()).toEqual(
      ["is_clear", "priority", "repo_fit", "size", "type"].sort(),
    )
  })
  test("repo_fit has true/false criteria (subtle boundary)", () => {
    const q = buildJevQuestions("duty", []) as any
    expect(q.repo_fit.type).toBe("noul")
    expect(q.repo_fit.criteria.true).toBeString()
    expect(q.repo_fit.criteria.false).toBeString()
  })
  test("one Noul per candidate with attribution id", () => {
    const q = buildJevQuestions("duty", [
      { number: 7, title: "t", summary: "s" },
      { number: 9, title: "t2", summary: "s2" },
    ]) as any
    expect(q["same_as_7"].type).toBe("noul")
    expect(q["same_as_9"].type).toBe("noul")
    expect(q["same_as_7"].instructions.candidate.number).toBe(7)
  })
  test("size levels are single-dimension situations", () => {
    const q = buildJevQuestions("duty", []) as any
    expect(q.size.criteria.length).toBe(4)
    expect(q.size.criteria.join(" ").toLowerCase()).not.toContain("xs")
  })
  test("state holds role + new only (candidates ride in questions)", () => {
    const s = buildJevState({ role: "duty", freshTitle: "t", freshBody: "b" })
    expect(s).toContain("ROLE")
    expect(s).toContain("NEW")
  })
})

describe("jevIntake parsing", () => {
  const answers = {
    repo_fit: { type: "noul", noul: 0.9 },
    is_clear: { type: "score", score: 1.6, confidence: 0.8, probabilities: {}, legend: {} },
    type: { type: "choice", choice: "bug", confidence: 0.9, probabilities: {} },
    size: { type: "score", score: 2.1, confidence: 0.7, probabilities: {}, legend: {} },
    priority: { type: "score", score: 0.6, confidence: 0.5, probabilities: {}, legend: {} },
    same_as_7: { type: "noul", noul: 0.95 },
    same_as_9: { type: "noul", noul: 0.2 },
  }
  const fakeFetch = (async () => ({
    ok: true,
    json: async () => ({ model: "jev-1.13-free", answers }),
  })) as unknown as typeof fetch

  test("normalizes scores and attributes duplicates", async () => {
    const out = await jevIntake(
      { role: "d", freshTitle: "t", freshBody: "b" },
      [{ number: 7, title: "t7", summary: "s7" }, { number: 9, title: "t9", summary: "s9" }],
      { url: "https://x", key: "k", model: "m" },
      fakeFetch,
    )
    expect(out!.is_clear).toBeCloseTo(1.6 / 2, 5)
    expect(out!.size).toBeCloseTo(2.1 / 3, 5)
    expect(out!.duplicate).toBeCloseTo(0.95, 5)
    expect(out!.duplicateOf).toEqual([7])
    expect(out!.confidences.is_clear).toBe(0.8)
  })
  test("no candidates -> duplicate null (unknown, not zero)", async () => {
    const out = await jevIntake(
      { role: "d", freshTitle: "t", freshBody: "b" },
      [],
      { url: "https://x", key: "k", model: "m" },
      fakeFetch,
    )
    expect(out!.duplicate).toBeNull()
    expect(out!.duplicateOf).toEqual([])
  })
  test("null stays null even with ambient keys (fail-closed, no env fallback)", async () => {
    const prev = process.env.OPENCODE_API_KEY
    process.env.OPENCODE_API_KEY = "ambient-should-not-leak"
    try {
      expect(await jevIntake({ role: "d", freshTitle: "t", freshBody: "b" }, [], null)).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_API_KEY
      else process.env.OPENCODE_API_KEY = prev
    }
  })
})

describe("jevEndpointFromEnv (JEV_MODEL drives endpoint+model)", () => {
  test("bare id -> opencode gateway", () => {
    const ep = jevEndpointFromEnv({ JEV_MODEL: "jev-1.13", OPENCODE_API_KEY: "k" } as any)
    expect(ep).toEqual({ url: OPENCODE_JEV_URL, key: "k", model: "jev-1.13" })
  })
  test("opencode/ prefix -> opencode gateway, prefix stripped", () => {
    const ep = jevEndpointFromEnv({ JEV_MODEL: "opencode/jev-1.13", OPENCODE_API_KEY: "k" } as any)
    expect(ep).toEqual({ url: OPENCODE_JEV_URL, key: "k", model: "jev-1.13" })
  })
  test("typesafe/ prefix -> direct API with TypeSafe key only", () => {
    const ep = jevEndpointFromEnv({ JEV_MODEL: "typesafe/jev-1.13.0", TS_API_KEY: "ts" } as any)
    expect(ep).toEqual({ url: DIRECT_JEV_URL, key: "ts", model: "jev-1.13.0" })
  })
  test("keys never cross routes", () => {
    expect(jevEndpointFromEnv({ JEV_MODEL: "typesafe/jev-1.13.0", OPENCODE_API_KEY: "k" } as any)).toBeNull()
    expect(jevEndpointFromEnv({ JEV_MODEL: "jev-1.13", TS_API_KEY: "ts" } as any)).toBeNull()
  })
  test("empty JEV_MODEL -> default opencode jev-1.13", () => {
    const ep = jevEndpointFromEnv({ JEV_MODEL: "", OPENCODE_API_KEY: "k" } as any)
    expect(ep).toEqual({ url: OPENCODE_JEV_URL, key: "k", model: DEFAULT_JEV_MODEL })
  })
  test("inputs.llm-api-key arrives as LLM_API_KEY", () => {
    const ep = jevEndpointFromEnv({ JEV_MODEL: "jev-1.13", LLM_API_KEY: "l" } as any)
    expect(ep!.key).toBe("l")
  })
  test("no key -> null (fail-closed to human)", () => {
    expect(jevEndpointFromEnv({ JEV_MODEL: "jev-1.13" } as any)).toBeNull()
  })
  test("request body carries env model", async () => {
    let body: any = null
    const fakeFetch = (async (_u: any, init: any) => {
      body = JSON.parse(init.body)
      return { ok: true, json: async () => ({ model: "m", answers: {} }) }
    }) as unknown as typeof fetch
    await jevIntake(
      { role: "d", freshTitle: "t", freshBody: "b" },
      [],
      { url: "https://example.invalid/x", key: "k", model: "jev-pin-test" },
      fakeFetch,
    )
    expect(body.model).toBe("jev-pin-test")
  })
})

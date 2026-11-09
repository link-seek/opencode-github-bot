import { describe, expect, test } from "bun:test"
import { classifyVerdict, parseMarker } from "../scripts/verdict"

describe("parseMarker", () => {
  test("extracts decision + labels from hidden comment", () => {
    const m = parseMarker('hi\n<!--pm-intake:{"v":1,"decision":"needs-split","labels":["needs-split"]}-->');
    expect(m?.decision).toBe("needs-split")
    expect(m?.labels).toEqual(["needs-split"])
  })
  test("null when no marker", () => {
    expect(parseMarker("plain comment")).toBeNull()
  })
})

describe("classifyVerdict", () => {
  test("human reopen of bot close -> override", () => {
    const r = classifyVerdict(
      { decision: "duplicate-close", labels: ["duplicate"] },
      { labels: [], state: "open", event: "reopened" },
    )
    expect(r.verdict).toBe("override")
  })
  test("human completed bot-routed issue -> agree", () => {
    const r = classifyVerdict(
      { decision: "ready", labels: ["ready"] },
      { labels: ["ready"], state: "closed", event: "closed" },
    )
    expect(r.verdict).toBe("agree")
  })
  test("human changed route labels -> override", () => {
    const r = classifyVerdict(
      { decision: "needs-split", labels: ["needs-split"] },
      { labels: ["ready"], state: "open", event: "labeled" },
    )
    expect(r.verdict).toBe("override")
  })
  test("no bot record -> unclear, never auto-blame", () => {
    const r = classifyVerdict(
      { decision: null, labels: [] },
      { labels: ["bug"], state: "open", event: "labeled" },
    )
    expect(r.verdict).toBe("unclear")
  })
  test("route untouched -> unclear", () => {
    const r = classifyVerdict(
      { decision: "ready", labels: ["ready"] },
      { labels: ["ready"], state: "open", event: "edited" },
    )
    expect(r.verdict).toBe("unclear")
  })
})

describe("llm-judge contract", () => {
  test("parses JSON answer + usage", async () => {
    const { llmJudge } = await import("../scripts/llm-judge")
    const fake = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"repo_fit":0.9,"is_clear":0.8,"type":"bug","size":0.3,"priority":0.5,"duplicate":0.1}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    })) as unknown as typeof fetch
    const r = await llmJudge("duty", "t", "b", [], fake, { LLM_API_KEY: "x", LLM_BASE_URL: "https://x" } as any)
    expect(r.type).toBe("bug")
    expect(r.inputTokens).toBe(100)
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

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
    const r = await llmJudge("duty", "t", "b", [], fake, { LLM_API_KEY: "x", LLM_BASE_URL: "https://x", OPENCODE_MODEL: "test-model" } as any)
    expect(r.type).toBe("bug")
    expect(r.inputTokens).toBe(100)
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })
  test("whitespace-only model throws (trimmed before check)", async () => {
    const { llmJudge } = await import("../scripts/llm-judge")
    const fake = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
    await expect(llmJudge("d", "t", "b", [], fake, { LLM_API_KEY: "x", OPENCODE_MODEL: "   " } as any)).rejects.toThrow("need LLM_JUDGE_MODEL")
  })
  test("go endpoint gets x-opencode-session header, others do not", async () => {
    const { llmJudge } = await import("../scripts/llm-judge")
    const seen: any[] = []
    const fake = (async (_u: any, init: any) => {
      seen.push(init.headers)
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"repo_fit":0.5,"is_clear":0.5,"type":"bug","size":0.5,"priority":0.5,"duplicate":0}' } }],
          usage: {},
        }),
      }
    }) as unknown as typeof fetch
    await llmJudge("d", "t", "b", [], fake, {
      LLM_API_KEY: "x", OPENCODE_MODEL: "beam-free",
      LLM_BASE_URL: "https://opencode.ai/inference/go/openai/v1",
      GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
    } as any)
    expect(seen[0]["x-opencode-session"]).toBe("gh-123-2")
    await llmJudge("d", "t", "b", [], fake, {
      LLM_API_KEY: "x", OPENCODE_MODEL: "beam-free",
      LLM_BASE_URL: "https://opencode.ai/inference/openai/v1",
    } as any)
    expect(seen[1]["x-opencode-session"]).toBeUndefined()
  })
    const { llmJudge } = await import("../scripts/llm-judge")
    const fake = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
    await expect(llmJudge("d", "t", "b", [], fake, { LLM_API_KEY: "x", OPENCODE_MODEL: "   " } as any)).rejects.toThrow("need LLM_JUDGE_MODEL")
  })
  test("composite model var: id stripped, explicit base wins", async () => {
    const { llmJudge } = await import("../scripts/llm-judge")
    let seen: any = null
    const fake = (async (_u: any, init: any) => {
      seen = { url: _u, body: JSON.parse(init.body) }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"repo_fit":0.9,"is_clear":0.8,"type":"bug","size":0.3,"priority":0.5,"duplicate":0.1}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      }
    }) as unknown as typeof fetch
    const r = await llmJudge("d", "t", "b", [], fake, { LLM_API_KEY: "x", OPENCODE_MODEL: "custom/my-model https://llm.invalid/v1" } as any)
    expect(r.type).toBe("bug")
    expect(seen.url).toBe("https://llm.invalid/v1/chat/completions")
    expect(seen.body.model).toBe("my-model")
  })
  test("malformed model output throws clear error (no crash)", async () => {
    const { llmJudge } = await import("../scripts/llm-judge")
    const fake = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "no json here" } }], usage: {} }),
    })) as unknown as typeof fetch
    await expect(llmJudge("d", "t", "b", [], fake, { LLM_API_KEY: "x", OPENCODE_MODEL: "m" } as any)).rejects.toThrow("llm-judge")
  })
})

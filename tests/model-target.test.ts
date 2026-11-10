import { describe, expect, test } from "bun:test"
import { apiTargetFor, splitModelTarget } from "../scripts/model-target"

describe("splitModelTarget", () => {
  test("CLI form splits provider + bare id", () => {
    expect(splitModelTarget("opencode-go/beam-free")).toEqual({
      provider: "opencode-go",
      model: "beam-free",
    })
  })
  test("bare id stays whole (API form)", () => {
    expect(splitModelTarget("beam-free")).toEqual({ provider: "", model: "beam-free" })
  })
  test("trims whitespace, rejects empty halves", () => {
    expect(splitModelTarget("  opencode/jev-1.13-free  ")).toEqual({
      provider: "opencode",
      model: "jev-1.13-free",
    })
    expect(splitModelTarget("opencode/")).toEqual({ provider: "", model: "opencode/" })
  })
})

describe("apiTargetFor", () => {
  test("known provider -> table base URL + bare id", () => {
    const t = apiTargetFor("opencode-go/beam-free", "https://fallback.invalid/v1")
    expect(t).toEqual({
      provider: "opencode-go",
      model: "beam-free",
      baseUrl: "https://opencode.ai/inference/openai/v1",
    })
  })
  test("unknown provider -> caller fallback", () => {
    const t = apiTargetFor("custom/my-model", "https://fallback.invalid/v1")
    expect(t.baseUrl).toBe("https://fallback.invalid/v1")
    expect(t.model).toBe("my-model")
  })
  test("unknown provider without fallback -> null base (caller fails closed)", () => {
    expect(apiTargetFor("custom/my-model").baseUrl).toBeNull()
  })
  test("bare id resolves against caller fallback (may be gateway default)", () => {
    const t = apiTargetFor("beam-free", "https://gw.invalid/v1")
    expect(t).toEqual({ provider: "", model: "beam-free", baseUrl: "https://gw.invalid/v1" })
  })
})

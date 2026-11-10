import { describe, expect, test } from "bun:test"
import { parseModelVar } from "../scripts/model-target"

describe("parseModelVar (one variable, CLI+API)", () => {
  test("composite: first token CLI, second token API base, id after last slash", () => {
    expect(parseModelVar("opencode-go/beam-free https://opencode.ai/inference/openai/v1")).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://opencode.ai/inference/openai/v1",
      apiId: "beam-free",
    })
  })
  test("jev composite with zen endpoint", () => {
    expect(parseModelVar("jev-1.13-free https://opencode.ai/zen/v1/systemone")).toEqual({
      cli: "jev-1.13-free",
      apiBase: "https://opencode.ai/zen/v1/systemone",
      apiId: "jev-1.13-free",
    })
  })
  test("single token (legacy): CLI as-is, no base, id after slash", () => {
    expect(parseModelVar("opencode-go/beam-free")).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "",
      apiId: "beam-free",
    })
    expect(parseModelVar("jev-1.13-free")).toEqual({
      cli: "jev-1.13-free",
      apiBase: "",
      apiId: "jev-1.13-free",
    })
  })
  test("empty/whitespace -> all empty", () => {
    expect(parseModelVar("")).toEqual({ cli: "", apiBase: "", apiId: "" })
    expect(parseModelVar("   ")).toEqual({ cli: "", apiBase: "", apiId: "" })
  })
  test("extra whitespace tolerated, extras beyond two ignored", () => {
    expect(parseModelVar("  a/b   https://x  ")).toEqual({ cli: "a/b", apiBase: "https://x", apiId: "b" })
  })
})

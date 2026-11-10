import { describe, expect, test } from "bun:test"
import { parseModelVar } from "../scripts/model-target"

describe("parseModelVar (JSON variable, CLI+API)", () => {
  test("JSON: cli verbatim, apiBase as given, apiId derived", () => {
    expect(
      parseModelVar('{"cli":"opencode-go/beam-free","apiBase":"https://opencode.ai/inference/openai/v1"}'),
    ).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://opencode.ai/inference/openai/v1",
      apiId: "beam-free",
    })
  })
  test("JSON: explicit apiId wins over derivation", () => {
    expect(
      parseModelVar('{"cli":"x/y","apiBase":"https://h.invalid","apiId":"custom"}'),
    ).toEqual({ cli: "x/y", apiBase: "https://h.invalid", apiId: "custom" })
  })
  test("legacy space-separated still parses", () => {
    expect(parseModelVar("opencode-go/beam-free https://opencode.ai/inference/openai/v1")).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://opencode.ai/inference/openai/v1",
      apiId: "beam-free",
    })
  })
  test("legacy bare id: cli as-is, no base", () => {
    expect(parseModelVar("jev-1.13-free")).toEqual({
      cli: "jev-1.13-free",
      apiBase: "",
      apiId: "jev-1.13-free",
    })
  })
  test("empty / invalid JSON / missing cli -> all empty", () => {
    expect(parseModelVar("")).toEqual({ cli: "", apiBase: "", apiId: "" })
    expect(parseModelVar("   ")).toEqual({ cli: "", apiBase: "", apiId: "" })
    expect(parseModelVar("{oops")).toEqual({ cli: "", apiBase: "", apiId: "" })
    expect(parseModelVar('{"apiBase":"https://h.invalid"}')).toEqual({ cli: "", apiBase: "", apiId: "" })
  })
})

import { describe, expect, test } from "bun:test"
import { modelTargets, parseModelTargets, parseModelVar } from "../scripts/model-target"

const NONE = { fallbackCli: "", fallbackApiBase: "", fallbackApiId: "" }

describe("parseModelVar (JSON variable, CLI+API)", () => {
  test("JSON: cli verbatim, apiBase as given, apiId derived", () => {
    expect(
      parseModelVar('{"cli":"opencode-go/beam-free","apiBase":"https://opencode.ai/inference/openai/v1"}'),
    ).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://opencode.ai/inference/openai/v1",
      apiId: "beam-free",
      ...NONE,
    })
  })
  test("JSON: explicit apiId wins over derivation", () => {
    expect(
      parseModelVar('{"cli":"x/y","apiBase":"https://h.invalid","apiId":"custom"}'),
    ).toEqual({ cli: "x/y", apiBase: "https://h.invalid", apiId: "custom", ...NONE })
  })
  test("legacy space-separated still parses", () => {
    expect(parseModelVar("opencode-go/beam-free https://opencode.ai/inference/openai/v1")).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://opencode.ai/inference/openai/v1",
      apiId: "beam-free",
      ...NONE,
    })
  })
  test("legacy bare id: cli as-is, no base", () => {
    expect(parseModelVar("jev-1.13-free")).toEqual({
      cli: "jev-1.13-free",
      apiBase: "",
      apiId: "jev-1.13-free",
      ...NONE,
    })
  })
  test("empty / invalid JSON / missing cli -> all empty", () => {
    const empty = { cli: "", apiBase: "", apiId: "", ...NONE }
    expect(parseModelVar("")).toEqual(empty)
    expect(parseModelVar("   ")).toEqual(empty)
    expect(parseModelVar("{oops")).toEqual(empty)
    expect(parseModelVar('{"apiBase":"https://h.invalid"}')).toEqual(empty)
  })
})

describe("parseModelVar dual-value (#120)", () => {
  test("fallback fields parse, fallback apiId derived from fallback_cli", () => {
    expect(
      parseModelVar('{"cli":"opencode-go/beam-free","apiBase":"https://a.invalid","fallback_cli":"opencode-go/muse-spark","fallback_apiBase":"https://b.invalid"}'),
    ).toEqual({
      cli: "opencode-go/beam-free",
      apiBase: "https://a.invalid",
      apiId: "beam-free",
      fallbackCli: "opencode-go/muse-spark",
      fallbackApiBase: "https://b.invalid",
      fallbackApiId: "muse-spark",
    })
  })
  test("explicit fallback_apiId wins", () => {
    const v = parseModelVar('{"cli":"x/y","apiBase":"https://a.invalid","fallback_cli":"x/z","fallback_apiBase":"https://b.invalid","fallback_apiId":"custom-fb"}')
    expect(v.fallbackApiId).toBe("custom-fb")
  })
  test("no fallback fields = no fallback (old shape unchanged)", () => {
    const v = parseModelVar('{"cli":"opencode-go/beam-free","apiBase":"https://a.invalid"}')
    expect(v.fallbackCli).toBe("")
    expect(modelTargets(v)).toHaveLength(1)
  })
  test("blank fallback_cli = no fallback", () => {
    const v = parseModelVar('{"cli":"a/b","apiBase":"https://a.invalid","fallback_cli":"  "}')
    expect(v.fallbackCli).toBe("")
    expect(modelTargets(v)).toHaveLength(1)
  })
  test("parseModelTargets expands primary + fallback", () => {
    const targets = parseModelTargets('{"cli":"p/beam-free","apiBase":"https://a.invalid","fallback_cli":"p/muse-spark","fallback_apiBase":"https://b.invalid"}')
    expect(targets).toEqual([
      { cli: "p/beam-free", apiBase: "https://a.invalid", apiId: "beam-free" },
      { cli: "p/muse-spark", apiBase: "https://b.invalid", apiId: "muse-spark" },
    ])
  })
  test("parseModelTargets empty on invalid", () => {
    expect(parseModelTargets("")).toEqual([])
    expect(parseModelTargets("{oops")).toEqual([])
  })
})

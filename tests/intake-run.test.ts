import { describe, expect, test } from "bun:test"
import { hitHardWords, isPretriagedChild, visibleComment, hiddenMarker } from "../scripts/intake-run"

describe("isPretriagedChild", () => {
  const marker = "<!--pm-split-part:46-->"
  const bot = { type: "Bot", association: "NONE" }
  const owner = { type: "User", association: "OWNER" }
  const stranger = { type: "User", association: "CONTRIBUTOR" }
  test("requires marker AND trusted author", () => {
    expect(isPretriagedChild("t", `x\n${marker}`, bot)).toBe(true)
    expect(isPretriagedChild("t", `x\n${marker}`, owner)).toBe(true)
    expect(isPretriagedChild("t", "Part of #46: foo", bot)).toBe(false)
    expect(isPretriagedChild("t", `x\n${marker}`, stranger)).toBe(false)
    expect(isPretriagedChild("t", "plain", bot)).toBe(false)
  })
})

describe("hitHardWords", () => {
  test("matches case-insensitive", () => {
    expect(hitHardWords("Fix Dockerfile", "x", ["Dockerfile"])).toBe("Dockerfile")
  })
  test("null when clean", () => {
    expect(hitHardWords("add badge", "readme", ["Dockerfile"])).toBeNull()
  })
})

describe("comments", () => {
  test("visible needs-info mentions 72h", () => {
    expect(visibleComment("needs-info", {})).toMatch(/72h/)
  })
  test("hidden marker parses", () => {
    const m = hiddenMarker({ v: 1, decision: "ready" })
    const json = m.replace("<!--pm-intake:", "").replace("-->", "")
    expect(JSON.parse(json).decision).toBe("ready")
  })
})

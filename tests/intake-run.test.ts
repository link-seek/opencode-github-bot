import { describe, expect, test } from "bun:test"
import { hitHardWords, isPretriagedChild, visibleComment, hiddenMarker } from "../scripts/intake-run"

describe("isPretriagedChild", () => {
  test("matches Part of #N in title or body", () => {
    expect(isPretriagedChild("[Part 1/2] A", "x")).toBe(false)
    expect(isPretriagedChild("t", "Part of #46: foo")).toBe(true)
    expect(isPretriagedChild("Part of #7", "")).toBe(true)
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

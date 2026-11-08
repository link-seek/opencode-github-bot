import { describe, expect, test } from "bun:test"
import { routeIntake } from "../scripts/intake-route"

const base = {
  roleMissing: false,
  repoFit: 1,
  emptyTemplate: false,
  exactDupOf: null,
  isClear: 0.9,
  size: 0.3,
  duplicate: 0,
  duplicateTop: null,
  typeConfidence: 1,
  lowConfidence: false,
} as const

describe("routeIntake", () => {
  test("role missing -> needs-human", () => {
    const r = routeIntake({ ...base, roleMissing: true, repoFit: null, isClear: null, size: null, duplicate: null, typeConfidence: null })
    expect(r.decision).toBe("needs-info")
    expect(r.labels).toContain("needs-human")
  })
  test("exact title dup closes", () => {
    const r = routeIntake({ ...base, exactDupOf: 42 })
    expect(r.decision).toBe("duplicate-close")
    expect(r.linkTo).toBe(42)
  })
  test("wrong repo rejected", () => {
    const r = routeIntake({ ...base, repoFit: 0.2 })
    expect(r.decision).toBe("rejected-out-of-scope")
  })
  test("repo borderline goes human, not auto", () => {
    const r = routeIntake({ ...base, repoFit: 0.6 })
    expect(r.decision).toBe("needs-review")
    expect(r.labels).toContain("repo-review")
  })
  test("low score confidence goes human", () => {
    const r = routeIntake({ ...base, lowConfidence: true })
    expect(r.decision).toBe("needs-review")
    expect(r.labels).toContain("low-confidence")
  })
  test("unclear -> needs-info", () => {
    const r = routeIntake({ ...base, isClear: 0.3 })
    expect(r.decision).toBe("needs-info")
  })
  test("big + clear -> needs-split", () => {
    const r = routeIntake({ ...base, size: 0.7 })
    expect(r.decision).toBe("needs-split")
  })
  test("small + clear -> ready", () => {
    const r = routeIntake({ ...base })
    expect(r.decision).toBe("ready")
  })
  test("Jev exact dup closes with attribution", () => {
    const r = routeIntake({ ...base, duplicate: 0.95, duplicateTop: 7 })
    expect(r.decision).toBe("duplicate-close")
    expect(r.linkTo).toBe(7)
  })
  test("Jev partial dup goes human", () => {
    const r = routeIntake({ ...base, duplicate: 0.8, duplicateTop: 7 })
    expect(r.decision).toBe("needs-review")
    expect(r.labels).toContain("possible-duplicate")
  })
  test("no Jev (all null) degrades to ready, never auto-close", () => {
    const r = routeIntake({ ...base, repoFit: null, isClear: null, size: null, duplicate: null, typeConfidence: null })
    expect(r.decision).toBe("ready")
  })
})

describe("recallQuery", () => {
  test("ORs distinctive tokens, drops stopwords", async () => {
    const { recallQuery } = await import("../scripts/issue-search")
    const q = recallQuery("probe: docs badge for README license", "Background probe body")
    expect(q).toContain(" OR ")
    expect(q).not.toMatch(/\bfor\b/)
    expect(q.toLowerCase()).toContain("badge")
    expect(q.split(" OR ").length).toBeLessThanOrEqual(5)
  })
})

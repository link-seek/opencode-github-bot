import { describe, expect, test } from "bun:test"
import { routeIntake } from "../scripts/intake-route"
import { buildJevState, buildJevQuestions, JEV_MODEL } from "../scripts/jev"

describe("routeIntake", () => {
  test("role missing -> needs-human", () => {
    const r = routeIntake({ roleMissing: true, repoFit: null, emptyTemplate: false, exactDupOf: null, isClear: null, size: null, duplicate: null, typeConfidence: null })
    expect(r.decision).toBe("needs-info")
    expect(r.labels).toContain("needs-human")
  })
  test("exact title dup closes", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 1, emptyTemplate: false, exactDupOf: 42, isClear: 1.6, size: 0.5, duplicate: 0, typeConfidence: 1 })
    expect(r.decision).toBe("duplicate-close")
    expect(r.linkTo).toBe(42)
  })
  test("wrong repo rejected", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 0.2, emptyTemplate: false, exactDupOf: null, isClear: 1.6, size: 0.5, duplicate: 0, typeConfidence: 1 })
    expect(r.decision).toBe("rejected-out-of-scope")
  })
  test("repo borderline goes human, not auto", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 0.6, emptyTemplate: false, exactDupOf: null, isClear: 1.6, size: 0.5, duplicate: 0, typeConfidence: 1 })
    expect(["ready", "needs-split"]).toContain(r.decision)
  })
  test("unclear -> needs-info", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 1, emptyTemplate: false, exactDupOf: null, isClear: 0.3, size: 0.1, duplicate: 0, typeConfidence: 1 })
    expect(r.decision).toBe("needs-info")
  })
  test("big + clear -> needs-split", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 1, emptyTemplate: false, exactDupOf: null, isClear: 1.6, size: 1.8, duplicate: 0, typeConfidence: 1 })
    expect(r.decision).toBe("needs-split")
  })
  test("small + clear -> ready", () => {
    const r = routeIntake({ roleMissing: false, repoFit: 1, emptyTemplate: false, exactDupOf: null, isClear: 1.6, size: 0.5, duplicate: 0, typeConfidence: 1 })
    expect(r.decision).toBe("ready")
  })
  test("no Jev (all null) degrades to ready, never auto-close", () => {
    const r = routeIntake({ roleMissing: false, repoFit: null, emptyTemplate: false, exactDupOf: null, isClear: null, size: null, duplicate: null, typeConfidence: null })
    expect(r.decision).toBe("ready")
  })
})

describe("jev contract", () => {
  test("model pinned, 6 questions", () => {
    expect(JEV_MODEL).toBe("jev-1.13.0")
    expect(Object.keys(buildJevQuestions("duty")).sort()).toEqual(
      ["duplicate", "is_clear", "priority", "repo_fit", "size", "type"].sort(),
    )
  })
  test("state contains role + new + candidates", () => {
    const s = buildJevState({ role: "duty", freshTitle: "t", freshBody: "b", candidates: [{ number: 7, title: "ct", summary: "cs" }] })
    expect(s).toContain("ROLE")
    expect(s).toContain("NEW")
    expect(s).toContain("#7")
  })
})

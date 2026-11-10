import { describe, expect, test } from "bun:test"
import {
  checkEntry,
  parseIntakeMarker,
  parseSplitPlanMarker,
  renderDraft,
  renderParentSplitSection,
  renderSubIssueBody,
  topoOrder,
  validatePlan,
} from "../scripts/split-run"

const MARKER =
  '<!--pm-intake:{"v":1,"decision":"needs-split","labels":["needs-split"],"scores":{}}-->'

describe("parseIntakeMarker", () => {
  test("extracts decision from hidden marker", () => {
    expect(parseIntakeMarker(`hi\n${MARKER}\nbye`)!.decision).toBe("needs-split")
  })
  test("null when absent or malformed", () => {
    expect(parseIntakeMarker("no marker")).toBeNull()
    expect(parseIntakeMarker("<!--pm-intake:oops-->")).toBeNull()
  })
})

describe("checkEntry", () => {
  test("needs-split label + marker decision gates entry", () => {
    const r = checkEntry(["needs-split"], MARKER)
    expect(r.ok).toBe(true)
  })
  test("missing label skips", () => {
    expect(checkEntry(["ready"], MARKER).ok).toBe(false)
  })
  test("marker decision mismatch skips", () => {
    const m = '<!--pm-intake:{"v":1,"decision":"ready"}-->'
    expect(checkEntry(["needs-split"], m).ok).toBe(false)
  })
})

describe("validatePlan", () => {
  const good = {
    verdict: "split",
    parent: 9,
    subs: [
      { title: "[Part 1/2] A", goal: "do a", files: ["a.ts"], acceptance: ["a works"], depends_on: [] },
      { title: "[Part 2/2] B", goal: "do b", files: ["b.ts", "c.ts"], acceptance: ["b works", "c works"], depends_on: [1] },
    ],
  }
  test("accepts a well-formed plan", () => {
    const r = validatePlan(good, 9)
    expect(r.ok).toBe(true)
  })
  test("rejects wrong parent (cross-issue application guard)", () => {
    const r = validatePlan(good, 10)
    expect(r.ok).toBe(false)
  })
  test("rejects >5 subs", () => {
    const subs = Array.from({ length: 6 }, (_, i) => ({
      title: `[Part ${i + 1}/6] X`, goal: "g", files: [], acceptance: ["ok"], depends_on: [],
    }))
    expect(validatePlan({ verdict: "split", parent: 1, subs }, 1).ok).toBe(false)
  })
  test("rejects >3 files in one sub", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].files = ["a", "b", "c", "d"]
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("rejects missing acceptance", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[1].acceptance = []
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("rejects bad title prefix", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].title = "A without tag"
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("rejects cycles", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].depends_on = [2]
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("reject verdict needs reason", () => {
    expect(validatePlan({ verdict: "reject", parent: 9, subs: [], reason: "unclear" }, 9).ok).toBe(true)
    expect(validatePlan({ verdict: "reject", parent: 9, subs: [] }, 9).ok).toBe(false)
  })
})

describe("topoOrder", () => {
  test("dependencies first", () => {
    const subs = [
      { title: "t", goal: "g", files: [], acceptance: ["a"], depends_on: [3] },
      { title: "t", goal: "g", files: [], acceptance: ["a"], depends_on: [] },
      { title: "t", goal: "g", files: [], acceptance: ["a"], depends_on: [2] },
    ]
    expect(topoOrder(subs)).toEqual([1, 2, 0])
  })
})

describe("rendering", () => {
  test("draft contains table + hidden marker", () => {
    const v = validatePlan({
      verdict: "split", parent: 9,
      subs: [{ title: "[Part 1/1] A", goal: "do a", files: ["a.ts"], acceptance: ["a works"], depends_on: [] }],
    }, 9)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const d = renderDraft(v.plan, "P title")
    expect(d).toContain("approve split")
    expect(d).toContain("[Part 1/1] A")
    const back = parseSplitPlanMarker(d)
    expect(back?.subs.length).toBe(1)
  })
  test("sub-issue body follows template", () => {
    const s = { title: "[Part 1/2] A", goal: "do a", files: ["a.ts"], acceptance: ["a works"], depends_on: [2] }
    const b = renderSubIssueBody(s, 0, 9, "P title")
    expect(b).toContain("Part of #9")
    expect(b).toContain("## 背景")
    expect(b).toContain("## 改动点")
    expect(b).toContain("## 验收标准")
    expect(b).toContain("## 依赖")
    expect(b).toContain("- [ ] a works")
  })
  test("parent section lists children as tasklist", () => {
    const s = renderParentSplitSection([{ number: 11, title: "[Part 1/1] A" }])
    expect(s).toContain("## Split into")
    expect(s).toContain("- [ ] #11")
  })
})

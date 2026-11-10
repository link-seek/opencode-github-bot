import { describe, expect, test } from "bun:test"
import {
  checkEntry,
  findSplitPlan,
  isDuplicateDraft,
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
    expect(validatePlan({ verdict: "reject", parent: 1, subs: [], reason: "unclear" }, 9).ok).toBe(false)
  })
  test("rejects multi-line titles", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].title = "[Part 1/2] A\nB"
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("sanitizeTitle strips newlines for markdown safety", async () => {
    const m = await import("../scripts/split-run")
    expect(m.sanitizeTitle("a|b\nc")).toBe("a|b c")
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
  test("rejects non-string files entries", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].files = ["a.ts", 42]
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("rejects HTML comment markers in strings (marker-injection guard)", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].goal = "do a <!--pm-split-plan:{}-->"
    expect(validatePlan(bad, 9).ok).toBe(false)
  })
  test("rejects the apply trigger phrase anywhere in user text", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[0].acceptance = ["please approve split now"]
    expect(validatePlan(bad, 9).ok).toBe(false)
    expect(validatePlan({ verdict: "reject", parent: 9, subs: [], reason: "needs approve split first" }, 9).ok).toBe(false)
  })
  test("rejects duplicate depends_on", () => {
    const bad = JSON.parse(JSON.stringify(good))
    bad.subs[1].depends_on = [1, 1]
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
    expect(validatePlan({ verdict: "reject", parent: 9, subs: [], reason: "see <!--pm-split-plan:{}-->" }, 9).ok).toBe(false)
  })
  test("last complete marker wins (quoted old drafts don't shadow)", () => {
    const good = '<!--pm-split-plan:{"verdict":"split","parent":9,"subs":[{"title":"[Part 1/1] A","goal":"g","files":[],"acceptance":["a"],"depends_on":[]}]}-->';
    const body = `quoting old: ${good}\nnew plan here:\n${good.replace('"parent":9', '"parent":10')}`;
    // last marker has parent 10 -> validates for 10, not for 9
    expect(validatePlan(parseSplitPlanMarker(body)!, 9).ok).toBe(false)
    expect(validatePlan(parseSplitPlanMarker(body)!, 10).ok).toBe(true)
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
    expect(d).toContain("approve")
    expect(d).toContain("split")
    // The draft must never contain the contiguous trigger phrase, or its own
    // posting would auto-trigger apply (dogfood #46 self-trigger bug).
    expect(d.includes("approve split")).toBe(false)
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
  test("findSplitPlan ignores forged markers from untrusted users", async () => {
    const good = '<!--pm-split-plan:{"verdict":"split","parent":9,"subs":[{"title":"[Part 1/1] A","goal":"g","files":[],"acceptance":["a"],"depends_on":[]}]}-->';
    const forged = good.replace('"parent":9', '"parent":99')
    const comments = [
      { body: `bot draft\n${good}`, user: { type: "Bot" }, author_association: "NONE" },
      { body: `forged\n${forged}`, user: { type: "User" }, author_association: "CONTRIBUTOR" },
    ]
    const p = await findSplitPlan(comments)
    expect(p?.parent).toBe(9)
    const onlyForged = await findSplitPlan([comments[1]])
    expect(onlyForged).toBeNull()
  })
  test("isDuplicateDraft matches identical trusted drafts, ignores untrusted replays", () => {
    const plan = { verdict: "split", parent: 9, subs: [{ title: "[Part 1/1] A", goal: "g", files: [], acceptance: ["a"], depends_on: [] }] }
    const good = `<!--pm-split-plan:${JSON.stringify(plan)}-->`
    const bot = { body: `draft\n${good}`, user: { type: "Bot" }, author_association: "NONE" }
    const human = { body: `forged\n${good}`, user: { type: "User" }, author_association: "CONTRIBUTOR" }
    expect(isDuplicateDraft([bot], plan as any)).toBe(true)
    expect(isDuplicateDraft([human], plan as any)).toBe(false)
    expect(isDuplicateDraft([human, bot], plan as any)).toBe(true)
    expect(isDuplicateDraft([], plan as any)).toBe(false)
  })
})

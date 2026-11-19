import { describe, expect, test } from "bun:test"
import { checkAffectedFiles, extractAffectedFiles, hitHardWords, isPretriagedChild, visibleComment, hiddenMarker } from "../scripts/intake-run"

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

describe("extractAffectedFiles (FILECHECK, no hardcoded prefixes)", () => {
  test("fixed field first", () => {
    const out = extractAffectedFiles("t", "### 影响文件\nk8s/opencode-team/deployment.yaml\n")
    expect(out).toEqual(["k8s/opencode-team/deployment.yaml"])
  })
  test("backtick + bare fallback, deduped", () => {
    const out = extractAffectedFiles("t", "see `docker/app/Dockerfile` and docker/app/Dockerfile")
    expect(out).toEqual(["docker/app/Dockerfile"])
  })
  test("rejects traversal/urls/spaces", () => {
    expect(extractAffectedFiles("t", "../etc/passwd")).toEqual([])
    expect(extractAffectedFiles("t", "https://x/y.yaml")).toEqual([])
    expect(extractAffectedFiles("t", "no slash here")).toEqual([])
  })
})

describe("checkAffectedFiles", () => {
  test("EXISTS/MISSING against checkout", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fc-"))
    fs.mkdirSync(path.join(root, "k8s"), { recursive: true })
    fs.writeFileSync(path.join(root, "k8s/a.yaml"), "x")
    const out = checkAffectedFiles(["k8s/a.yaml", "k8s/missing.yaml"], root)
    expect(out).toContain("k8s/a.yaml EXISTS")
    expect(out).toContain("k8s/missing.yaml MISSING")
    fs.rmSync(root, { recursive: true })
  })
})

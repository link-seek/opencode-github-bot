import { describe, expect, test } from "bun:test"
import {
  checkSecrets,
  checkVars,
  detectRepoType,
  generateWorkflow,
  runInit,
  runUpgrade,
} from "../scripts/init"

describe("detectRepoType", () => {
  test("node/python/go/rust/java by marker file", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const cases: Array<[string, string]> = [
      ["package.json", "node"],
      ["pyproject.toml", "python"],
      ["go.mod", "go"],
      ["Cargo.toml", "rust"],
      ["pom.xml", "java"],
    ]
    for (const [file, want] of cases) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-"))
      fs.writeFileSync(path.join(root, file), "{}")
      expect(detectRepoType(root)).toBe(want)
      fs.rmSync(root, { recursive: true })
    }
  })
  test("dotnet by real .csproj/.sln scan, not literal glob", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotnet-"))
    expect(detectRepoType(root)).toBe("generic")
    fs.writeFileSync(path.join(root, "App.csproj"), "<Project/>")
    expect(detectRepoType(root)).toBe("dotnet")
    fs.rmSync(root, { recursive: true })
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "dotnet2-"))
    fs.mkdirSync(path.join(root2, "Fake.csproj"))
    expect(detectRepoType(root2)).toBe("generic")
    fs.writeFileSync(path.join(root2, "App.sln"), "x")
    expect(detectRepoType(root2)).toBe("dotnet")
    fs.rmSync(root2, { recursive: true })
  })
})

describe("checkSecrets/checkVars", () => {
  test("ambient process.env counts (no arg)", () => {
    const prev = process.env.OPENCODE_API_KEY
    process.env.OPENCODE_API_KEY = "live-key"
    try {
      expect(checkSecrets().includes("OPENCODE_API_KEY")).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_API_KEY
      else process.env.OPENCODE_API_KEY = prev
    }
  })
  test("{ env } wrapper is unwrapped", () => {
    expect(checkSecrets({ env: { AGENT_GITHUB_TOKEN: "t", OPENCODE_API_KEY: "k" } })).toEqual([])
    expect(checkVars({ env: { OPENCODE_MODEL: "m" } })).toEqual([])
  })
  test("missing reported", () => {
    expect(checkSecrets({})).toContain("AGENT_GITHUB_TOKEN")
    expect(checkVars({})).toContain("OPENCODE_MODEL")
  })
})

describe("runInit", () => {
  test("custom workflowPath creates parent dirs and writes", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "init-"))
    const res = await runInit({ cwd: root, workflowPath: "custom/dir/bot.yml", write: true, env: {} })
    expect(res.written).toBe(true)
    expect(fs.existsSync(path.join(root, "custom", "dir", "bot.yml"))).toBe(true)
    expect(res.content).toContain("actions/checkout@v4")
    expect(res.content).toContain("npm install")
    fs.rmSync(root, { recursive: true })
  })
  test("no silent overwrite without force", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "init2-"))
    const first = await runInit({ cwd: root, write: true, env: {} })
    expect(first.written).toBe(true)
    const second = await runInit({ cwd: root, write: true, env: {} })
    expect(second.written).toBe(false)
    fs.rmSync(root, { recursive: true })
  })
  test("rejects workflow injection and path escape", async () => {
    const { generateWorkflow, runInit } = await import("../scripts/init")
    expect(() => generateWorkflow({ mode: "review\nevil: 1" })).toThrow()
    expect(() => generateWorkflow({ version: "v1\nmalicious" })).toThrow()
    expect(() => generateWorkflow({ model: "x # comment" })).toThrow()
    expect(() => generateWorkflow({ model: "a: b" })).toThrow()
    expect(generateWorkflow({})).toContain("model: ${{ vars.OPENCODE_MODEL }}")
    expect(generateWorkflow({ model: "opencode-go/beam-free" })).toContain("model: opencode-go/beam-free")
    expect(generateWorkflow({ version: "v9.9.9" })).toContain("bot-version: v9.9.9")
    expect(generateWorkflow({})).toContain("timeout-minutes: 20")
    expect(generateWorkflow({ timeoutMinutes: 45 })).toContain("timeout-minutes: 45")
    expect(() => generateWorkflow({ timeoutMinutes: 0 })).toThrow()
    expect(() => generateWorkflow({ timeoutMinutes: 9999 })).toThrow()
    // runInit catches generation errors into InitResult.error (machine-readable, no reject)
    const bad = await runInit({ cwd: root, timeoutMinutes: 0 } as any)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("timeoutMinutes")
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "init3-"))
    await expect(runInit({ cwd: root, workflowPath: "../escape.yml", write: true })).rejects.toThrow()
    fs.rmSync(root, { recursive: true })
  })
  test("upgrade single-pass counts each ref once, dry-run validates projections", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "up-"))
    fs.writeFileSync(path.join(root, "w.yml"), "uses: link-seek/opencode-github-bot/.github/workflows/review.yml@v0.5.0\nrun: npm i opencode-github-bot@0.5.0\n")
    const dry = await runUpgrade({ cwd: root, dryRun: true }, "v9.9.9")
    expect(dry.count).toBe(2)
    expect(dry.validated).toBe(true)
    expect(dry.remaining).toEqual([])
    // dry run writes nothing
    expect(fs.readFileSync(path.join(root, "w.yml"), "utf8")).toContain("@v0.5.0")
    const real = await runUpgrade({ cwd: root }, "v9.9.9")
    expect(real.count).toBe(2)
    expect(real.validated).toBe(true)
    expect(fs.readFileSync(path.join(root, "w.yml"), "utf8")).toContain("@v9.9.9")
    fs.rmSync(root, { recursive: true })
  })
})

import { describe, expect, test } from "bun:test"
import { detectTestCommand, runVerification, formatTestStatus } from "../.opencode/plugins/github-bot/lib"

describe("detectTestCommand", () => {
  test("uses VERIFY_COMMAND env var first", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: true, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      { test: "npm test" },
      "bun test && bun run typecheck",
    )
    expect(cmd).toBe("bun test && bun run typecheck")
  })

  test("detects npm test from package.json", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: true, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      { test: "jest" },
      undefined,
    )
    expect(cmd).toBe("jest")
  })

  test("detects verify script from package.json", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: true, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      { test: "jest", verify: "npm run lint && npm test" },
      undefined,
    )
    expect(cmd).toBe("npm run lint && npm test")
  })

  test("skips echo no test", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: true, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      { test: 'echo "Error: no test specified" && exit 1' },
      undefined,
    )
    expect(cmd).toBeNull()
  })

  test("detects Makefile", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: false, hasMakefile: true, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      undefined,
      undefined,
    )
    expect(cmd).toBe("make test")
  })

  test("detects Python", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: false, hasMakefile: false, hasPyproject: true, hasCargoToml: false, hasGoMod: false },
      undefined,
      undefined,
    )
    expect(cmd).toBe("pytest")
  })

  test("detects Rust", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: false, hasMakefile: false, hasPyproject: false, hasCargoToml: true, hasGoMod: false },
      undefined,
      undefined,
    )
    expect(cmd).toBe("cargo test")
  })

  test("detects Go", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: false, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: true },
      undefined,
      undefined,
    )
    expect(cmd).toBe("go test ./...")
  })

  test("returns null when nothing detected", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: false, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      undefined,
      undefined,
    )
    expect(cmd).toBeNull()
  })

  test("VERIFY_COMMAND takes priority over package.json", () => {
    const cmd = detectTestCommand(
      { hasPackageJson: true, hasMakefile: false, hasPyproject: false, hasCargoToml: false, hasGoMod: false },
      { test: "jest" },
      "npm run custom-test",
    )
    expect(cmd).toBe("npm run custom-test")
  })
})

describe("runVerification", () => {
  test("passed when command succeeds", async () => {
    const result = await runVerification("echo ok", async () => ({ stdout: "ok", stderr: "", code: 0 }))
    expect(result.status).toBe("passed")
    expect(result.command).toBe("echo ok")
    expect(result.output).toBe("ok")
  })

  test("failed when command fails", async () => {
    const result = await runVerification("npm test", async () => ({ stdout: "", stderr: "3 failures", code: 1 }))
    expect(result.status).toBe("failed")
    expect(result.output).toBe("3 failures")
  })

  test("not_run when no command", async () => {
    const result = await runVerification(null, async () => ({ stdout: "", stderr: "", code: 0 }))
    expect(result.status).toBe("not_run")
    expect(result.command).toBeNull()
  })

  test("error when command throws", async () => {
    const result = await runVerification("bad-cmd", async () => { throw new Error("spawn failed") })
    expect(result.status).toBe("error")
    expect(result.output).toBe("spawn failed")
  })

  test("uses stdout when stderr empty", async () => {
    const result = await runVerification("npm test", async () => ({ stdout: "Tests: 5 passed", stderr: "", code: 1 }))
    expect(result.status).toBe("failed")
    expect(result.output).toBe("Tests: 5 passed")
  })
})

describe("formatTestStatus", () => {
  test("passed format", () => {
    const s = formatTestStatus({ command: "npm test", status: "passed", output: "5 tests passed" })
    expect(s).toContain("✅ Tests passed")
    expect(s).toContain("npm test")
  })

  test("not_run format", () => {
    const s = formatTestStatus({ command: null, status: "not_run", output: "No test command detected" })
    expect(s).toContain("⚠️ Tests not run")
  })

  test("failed format", () => {
    const s = formatTestStatus({ command: "npm test", status: "failed", output: "3 failures" })
    expect(s).toContain("❌ Tests failed")
  })

  test("error format", () => {
    const s = formatTestStatus({ command: "npm test", status: "error", output: "spawn failed" })
    expect(s).toContain("⚠️ Tests could not run")
  })
})
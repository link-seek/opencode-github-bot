import { describe, expect, test } from "bun:test"
import { fenceUntrusted, randomNonce, validateIssueNumber, validateBranchName, isProtectedBranch } from "../.opencode/plugins/github-bot/lib"

describe("randomNonce", () => {
  test("returns 32-char hex string", () => {
    const n = randomNonce()
    expect(n).toMatch(/^[0-9a-f]{32}$/)
  })
  test("generates unique values", () => {
    const a = randomNonce()
    const b = randomNonce()
    expect(a).not.toBe(b)
  })
})

describe("fenceUntrusted", () => {
  test("wraps content with nonce markers", () => {
    const n = "abc123"
    const result = fenceUntrusted("hello world", n)
    expect(result).toBe("===== BEGIN UNTRUSTED PR CONTENT abc123 =====\nhello world\n===== END UNTRUSTED PR CONTENT abc123 =====")
  })
  test("handles empty content", () => {
    const n = "abc123"
    const result = fenceUntrusted("", n)
    expect(result).toContain("===== BEGIN UNTRUSTED PR CONTENT abc123 =====")
    expect(result).toContain("===== END UNTRUSTED PR CONTENT abc123 =====")
  })
  test("preserves multiline content", () => {
    const n = "abc123"
    const content = "line1\nline2\nline3"
    const result = fenceUntrusted(content, n)
    expect(result).toContain("line1\nline2\nline3")
  })
})

describe("validateIssueNumber", () => {
  test("accepts positive integer", () => {
    expect(validateIssueNumber(1).valid).toBe(true)
    expect(validateIssueNumber(42).valid).toBe(true)
    expect(validateIssueNumber(9999).valid).toBe(true)
  })
  test("rejects zero", () => {
    expect(validateIssueNumber(0).valid).toBe(false)
  })
  test("rejects negative", () => {
    expect(validateIssueNumber(-1).valid).toBe(false)
    expect(validateIssueNumber(-100).valid).toBe(false)
  })
  test("rejects non-integer", () => {
    expect(validateIssueNumber(1.5).valid).toBe(false)
    expect(validateIssueNumber(3.14).valid).toBe(false)
  })
  test("rejects NaN", () => {
    expect(validateIssueNumber(NaN).valid).toBe(false)
  })
  test("rejects null/undefined", () => {
    expect(validateIssueNumber(null).valid).toBe(false)
    expect(validateIssueNumber(undefined).valid).toBe(false)
  })
  test("rejects string", () => {
    expect(validateIssueNumber("42").valid).toBe(false)
  })
  test("rejects boolean", () => {
    expect(validateIssueNumber(true).valid).toBe(false)
  })
  test("error message present on failure", () => {
    const r = validateIssueNumber(0)
    expect(r.valid).toBe(false)
    expect(r.error).toBe("Error: invalid issue number")
  })
})

describe("validateBranchName", () => {
  test("accepts valid branch names", () => {
    expect(validateBranchName("fix/issue-42").valid).toBe(true)
    expect(validateBranchName("feature/add-badge").valid).toBe(true)
    expect(validateBranchName("opencode/issue160-20261030").valid).toBe(true)
  })
  test("rejects main", () => {
    expect(validateBranchName("main").valid).toBe(false)
  })
  test("rejects master", () => {
    expect(validateBranchName("master").valid).toBe(false)
  })
  test("rejects special characters", () => {
    expect(validateBranchName("fix;rm -rf /").valid).toBe(false)
    expect(validateBranchName("branch name with spaces").valid).toBe(false)
    expect(validateBranchName("branch$(whoami)").valid).toBe(false)
  })
  test("error message present on failure", () => {
    const r = validateBranchName("main")
    expect(r.valid).toBe(false)
    expect(r.error).toContain("invalid or protected branch name")
  })
})

describe("isProtectedBranch", () => {
  test("main is protected", () => {
    expect(isProtectedBranch("main")).toBe(true)
  })
  test("master is protected", () => {
    expect(isProtectedBranch("master")).toBe(true)
  })
  test("feature branches are not protected", () => {
    expect(isProtectedBranch("fix/issue-42")).toBe(false)
    expect(isProtectedBranch("feature/x")).toBe(false)
  })
})
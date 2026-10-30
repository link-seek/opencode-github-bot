import { describe, expect, test } from "bun:test"
import { finishFixCore, validateIssueNumber, validateBranchName } from "../.opencode/plugins/github-bot/lib"

describe("finishFixCore", () => {
  test("rejects invalid issue number", async () => {
    const deps = {
      runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(0, "summary", deps)
    expect(result).toContain("invalid issue number")
  })

  test("rejects negative issue number", async () => {
    const deps = {
      runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(-5, "summary", deps)
    expect(result).toContain("invalid issue number")
  })

  test("rejects non-integer issue number", async () => {
    const deps = {
      runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(1.5 as any, "summary", deps)
    expect(result).toContain("invalid issue number")
  })

  test("aborts on protected branch (main)", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "main", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("protected branch")
  })

  test("aborts on protected branch (master)", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "master", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("protected branch")
  })

  test("returns no changes when working tree clean", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("No changes detected")
  })

  test("commits and creates new PR when no existing PR", async () => {
    const calls: string[] = []
    const deps = {
      runShell: async (cmd: string) => {
        calls.push(cmd)
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "[main abc] fix", stderr: "", code: 0 }
        if (cmd.includes("git push")) return { stdout: "pushed", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async (method: string, path: string, body?: any) => {
        if (method === "GET" && path.includes("/pulls")) return []
        if (method === "POST" && path.includes("/pulls")) return { number: 99, html_url: "https://github.com/owner/repo/pull/99" }
        return {}
      },
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "my summary", deps)
    expect(result).toContain("Committed")
    expect(result).toContain("Pushed to fix/issue-42")
    expect(result).toContain("Created PR #99")
  })

  test("updates existing PR when one exists", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "[main abc] fix", stderr: "", code: 0 }
        if (cmd.includes("git push")) return { stdout: "pushed", stderr: "", code: 0 }
        if (cmd.includes("git fetch") || cmd.includes("git checkout") || cmd.includes("git cherry-pick")) return { stdout: "", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async (method: string, path: string, body?: any) => {
        if (method === "GET" && path.includes("/pulls")) return [{ number: 55, body: "Closes #42", head: { ref: "fix/issue-42" } }]
        if (method === "POST" && path.includes("/comments")) return { id: 1 }
        return {}
      },
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "my summary", deps)
    expect(result).toContain("Committed")
    expect(result).toContain("Pushed to fix/issue-42")
    expect(result).toContain("Updated existing PR #55")
  })

  test("handles commit failure", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "", stderr: "commit error", code: 1 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async () => ({}),
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("Commit failed")
  })

  test("handles push failure", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "[main abc] fix", stderr: "", code: 0 }
        if (cmd.includes("git push")) return { stdout: "", stderr: "push error", code: 1 }
        if (cmd.includes("git checkout -b")) return { stdout: "", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async () => [],
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("Push failed")
  })

  test("handles PR creation failure gracefully", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "[main abc] fix", stderr: "", code: 0 }
        if (cmd.includes("git push")) return { stdout: "pushed", stderr: "", code: 0 }
        if (cmd.includes("git checkout -b")) return { stdout: "", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async (method: string, path: string, body?: any) => {
        if (method === "GET" && path.includes("/pulls")) return []
        if (method === "POST" && path.includes("/pulls")) throw new Error("API error 422")
        return {}
      },
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("PR creation failed")
  })

  test("validates branch name safety", async () => {
    const deps = {
      runShell: async (cmd: string) => {
        if (cmd === "git branch --show-current") return { stdout: "fix/issue-42", stderr: "", code: 0 }
        if (cmd === "git status --porcelain") return { stdout: "M src/foo.ts", stderr: "", code: 0 }
        if (cmd === "git diff --stat && git diff --cached --stat") return { stdout: "1 file changed", stderr: "", code: 0 }
        if (cmd.includes("git commit")) return { stdout: "[main abc] fix", stderr: "", code: 0 }
        if (cmd.includes("git push")) return { stdout: "pushed", stderr: "", code: 0 }
        if (cmd.includes("git checkout -b")) return { stdout: "", stderr: "", code: 0 }
        return { stdout: "", stderr: "", code: 0 }
      },
      ghApi: async (method: string, path: string, body?: any) => {
        if (method === "GET" && path.includes("/pulls")) return [{ number: 55, body: "Closes #42", head: { ref: "main" } }]
        return {}
      },
      repo: "owner/repo",
    }
    const result = await finishFixCore(42, "summary", deps)
    expect(result).toContain("invalid or protected branch name")
  })
})
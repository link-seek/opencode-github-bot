import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { assemblePRContext, assembleIssueContext } from "../scripts/context"

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token"
  process.env.GITHUB_REPOSITORY = "owner/repo"
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

describe("assemblePRContext", () => {
  test("includes PR title and author", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/pulls/42") && !url.includes("/files")) {
        return new Response(JSON.stringify({
          title: "Fix bug", body: "Description here", base: { ref: "main" },
          head: { ref: "fix/bug", sha: "abc123" }, user: { login: "alice" }, number: 42,
        }), { status: 200 })
      }
      if (url.includes("/files")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes("/graphql")) {
        return new Response(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] }, reviewThreads: { nodes: [] } } } } }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as any

    const result = await assemblePRContext(42)
    expect(result).toContain("# PR Context")
    expect(result).toContain("Fix bug")
    expect(result).toContain("@alice")
    expect(result).toContain("main")
    expect(result).toContain("fix/bug")
    expect(result).toContain("abc123")
  })

  test("includes nonce fence around PR content", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/pulls/1") && !url.includes("/files")) {
        return new Response(JSON.stringify({
          title: "Test", body: "Body", base: { ref: "main" },
          head: { ref: "feat", sha: "sha1" }, user: { login: "bob" }, number: 1,
        }), { status: 200 })
      }
      if (url.includes("/files")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/graphql")) return new Response(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] }, reviewThreads: { nodes: [] } } } } }), { status: 200 })
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assemblePRContext(1)
    expect(result).toMatch(/===== BEGIN UNTRUSTED PR CONTENT [0-9a-f]{32} =====/)
    expect(result).toMatch(/===== END UNTRUSTED PR CONTENT [0-9a-f]{32} =====/)
  })

  test("includes linked issues", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/pulls/5") && !url.includes("/files")) {
        return new Response(JSON.stringify({
          title: "PR", body: "Body", base: { ref: "main" },
          head: { ref: "feat", sha: "sha" }, user: { login: "u" }, number: 5,
        }), { status: 200 })
      }
      if (url.includes("/files")) return new Response(JSON.stringify([]), { status: 200 })
      if (url.includes("/graphql")) {
        return new Response(JSON.stringify({
          data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 10, title: "Issue title", body: "Issue body" }] }, reviewThreads: { nodes: [] } } } }
        }), { status: 200 })
      }
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assemblePRContext(5)
    expect(result).toContain("Linked Issues")
    expect(result).toContain("#10: Issue title")
  })

  test("includes files manifest", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/pulls/7") && !url.includes("/files")) {
        return new Response(JSON.stringify({
          title: "PR", body: "Body", base: { ref: "main" },
          head: { ref: "feat", sha: "sha" }, user: { login: "u" }, number: 7,
        }), { status: 200 })
      }
      if (url.includes("/files")) {
        return new Response(JSON.stringify([
          { filename: "src/foo.ts", status: "modified", patch: "+added line" },
        ]), { status: 200 })
      }
      if (url.includes("/graphql")) return new Response(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] }, reviewThreads: { nodes: [] } } } } }), { status: 200 })
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assemblePRContext(7)
    expect(result).toContain("Files Changed")
    expect(result).toContain("modified: src/foo.ts")
    expect(result).toContain("Patches")
  })

  test("truncates large patches", async () => {
    const bigPatch = "x".repeat(10000)
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/pulls/8") && !url.includes("/files")) {
        return new Response(JSON.stringify({
          title: "PR", body: "Body", base: { ref: "main" },
          head: { ref: "feat", sha: "sha" }, user: { login: "u" }, number: 8,
        }), { status: 200 })
      }
      if (url.includes("/files")) {
        return new Response(JSON.stringify([
          { filename: "big.ts", status: "modified", patch: bigPatch },
        ]), { status: 200 })
      }
      if (url.includes("/graphql")) return new Response(JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] }, reviewThreads: { nodes: [] } } } } }), { status: 200 })
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assemblePRContext(8)
    expect(result).toContain("[patch abbreviated")
  })

  test("throws on PR not found", async () => {
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as any
    try {
      await assemblePRContext(999)
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.message).toContain("404")
    }
  })
})

describe("assembleIssueContext", () => {
  test("includes issue title and author", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/issues/42") && !url.includes("/comments")) {
        return new Response(JSON.stringify({
          title: "Bug report", body: "Description", user: { login: "alice" },
          labels: [{ name: "bug" }], number: 42,
        }), { status: 200 })
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assembleIssueContext(42)
    expect(result).toContain("# Issue Context")
    expect(result).toContain("Bug report")
    expect(result).toContain("@alice")
    expect(result).toContain("bug")
  })

  test("includes recent comments", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/issues/7") && !url.includes("/comments")) {
        return new Response(JSON.stringify({
          title: "Issue", body: "Body", user: { login: "u" },
          labels: [], number: 7,
        }), { status: 200 })
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify([
          { user: { login: "commenter" }, body: "A comment", created_at: "2026-10-30T00:00:00Z" },
        ]), { status: 200 })
      }
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assembleIssueContext(7)
    expect(result).toContain("Recent Comments")
    expect(result).toContain("@commenter")
    expect(result).toContain("A comment")
  })

  test("handles no comments", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/issues/3") && !url.includes("/comments")) {
        return new Response(JSON.stringify({
          title: "Issue", body: "Body", user: { login: "u" },
          labels: [], number: 3,
        }), { status: 200 })
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assembleIssueContext(3)
    expect(result).toContain("# Issue Context")
    expect(result).not.toContain("Recent Comments")
  })

  test("throws on issue not found", async () => {
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as any
    try {
      await assembleIssueContext(999)
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.message).toContain("404")
    }
  })

  test("nonce fence present", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/issues/1") && !url.includes("/comments")) {
        return new Response(JSON.stringify({
          title: "T", body: "B", user: { login: "u" },
          labels: [], number: 1,
        }), { status: 200 })
      }
      if (url.includes("/comments")) return new Response(JSON.stringify([]), { status: 200 })
      return new Response("nf", { status: 404 })
    }) as any

    const result = await assembleIssueContext(1)
    expect(result).toMatch(/===== BEGIN UNTRUSTED PR CONTENT [0-9a-f]{32} =====/)
  })
})
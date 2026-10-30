import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { ghApi, runShell } from "../.opencode/plugins/github-bot/lib"

describe("ghApi", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns parsed JSON on success", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ id: 42 }), { status: 200 })) as any
    const result = await ghApi("GET", "/repos/test/repo")
    expect(result).toEqual({ id: 42 })
  })

  test("throws on HTTP error", async () => {
    globalThis.fetch = mock(async () => new Response("Not Found", { status: 404, statusText: "Not Found" })) as any
    try {
      await ghApi("GET", "/repos/test/repo")
      expect(true).toBe(false) // should not reach
    } catch (e: any) {
      expect(e.message).toContain("404")
    }
  })

  test("throws on server error", async () => {
    globalThis.fetch = mock(async () => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })) as any
    try {
      await ghApi("POST", "/repos/test/repo/issues", { body: "test" })
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e.message).toContain("500")
    }
  })

  test("sends correct headers", async () => {
    let capturedHeaders: any = null
    globalThis.fetch = mock(async (url: string, opts: any) => {
      capturedHeaders = opts.headers
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    await ghApi("POST", "/repos/test/repo/issues", { body: "test" }, undefined, "test-token")
    expect(capturedHeaders.Authorization).toBe("Bearer test-token")
    expect(capturedHeaders.Accept).toBe("application/vnd.github+json")
    expect(capturedHeaders["X-GitHub-Api-Version"]).toBe("2022-11-28")
  })

  test("sends body for POST", async () => {
    let capturedBody: string | null = null
    globalThis.fetch = mock(async (url: string, opts: any) => {
      capturedBody = opts.body
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    await ghApi("POST", "/repos/test/repo/issues", { title: "test" })
    expect(JSON.parse(capturedBody!)).toEqual({ title: "test" })
  })

  test("no body for GET", async () => {
    let capturedBody: string | null = null
    globalThis.fetch = mock(async (url: string, opts: any) => {
      capturedBody = opts.body
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    await ghApi("GET", "/repos/test/repo")
    expect(capturedBody).toBeUndefined()
  })

  test("uses provided token", async () => {
    let capturedHeaders: any = null
    globalThis.fetch = mock(async (url: string, opts: any) => {
      capturedHeaders = opts.headers
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    await ghApi("GET", "/repos/test/repo", undefined, undefined, "my-custom-token")
    expect(capturedHeaders.Authorization).toBe("Bearer my-custom-token")
  })

  test("constructs correct URL", async () => {
    let capturedUrl: string = ""
    globalThis.fetch = mock(async (url: string, opts: any) => {
      capturedUrl = url
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    await ghApi("GET", "/repos/owner/repo/pulls")
    expect(capturedUrl).toBe("https://api.github.com/repos/owner/repo/pulls")
  })
})

describe("runShell", () => {
  test("executes simple command", async () => {
    const result = await runShell("echo hello")
    expect(result.stdout).toBe("hello")
    expect(result.code).toBe(0)
  })

  test("returns non-zero exit code on failure", async () => {
    const result = await runShell("false")
    expect(result.code).not.toBe(0)
  })

  test("captures stderr", async () => {
    const result = await runShell("echo err >&2")
    expect(result.stderr).toBe("err")
  })

  test("handles command not found", async () => {
    const result = await runShell("nonexistent_command_xyz_123")
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("not found")
  })

  test("uses custom spawn function", async () => {
    const mockSpawn = async (cmd: string, cwd: string) => ({
      stdout: "mocked",
      stderr: "",
      code: 0,
    })
    const result = await runShell("anything", "/tmp", mockSpawn)
    expect(result.stdout).toBe("mocked")
    expect(result.code).toBe(0)
  })

  test("trims output", async () => {
    const result = await runShell("echo '  spaces  '")
    expect(result.stdout).toBe("spaces")
  })
})
import { describe, expect, test } from "bun:test"
import { cfConfigFromEnv, cfMintChild } from "../scripts/cf-recall"

describe("cfConfigFromEnv", () => {
  test("null without token (graceful skip)", () => {
    expect(cfConfigFromEnv({} as any)).toBeNull()
  })
  test("reads token + defaults", () => {
    const c = cfConfigFromEnv({ CF_PARENT_TOKEN: "x" } as any)!
    expect(c.token).toBe("x")
    expect(c.index).toBe("opencode-intake")
    expect(c.embedModel).toBe("@cf/baai/bge-m3")
  })
})

describe("cfMintChild", () => {
  test("returns null when group lookup fails (strict: no parent use)", async () => {
    const badFetch = (async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as typeof fetch
    const r = await cfMintChild({ token: "x" } as any, 600, badFetch)
    expect(r).toBeNull()
  })
  test("mints from group list (mocked)", async () => {
    const calls: string[] = []
    const fake = (async (url: any, init?: any) => {
      calls.push(String(url))
      if (String(url).includes("permission_groups"))
        return { ok: true, json: async () => ({ result: [{ id: "g1", name: "Vectorize Read" }, { id: "g2", name: "Workers AI Read" }] }) } as any
      return { ok: true, json: async () => ({ result: { value: "child-123" } }) } as any
    }) as unknown as typeof fetch
    const r = await cfMintChild({ token: "parent", accountId: "acc" } as any, 600, fake)
    expect(r).toBe("child-123")
    expect(calls.some((u) => u.includes("/user/tokens"))).toBe(true)
  })
})

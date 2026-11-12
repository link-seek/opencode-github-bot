import { describe, expect, test } from "bun:test"
import { laminarEnabled, withSpan } from "../scripts/trace"

describe("laminarEnabled", () => {
  test("missing key disables tracing", () => {
    expect(laminarEnabled({} as any)).toBe(false)
    expect(laminarEnabled({ LMNR_PROJECT_API_KEY: "  " } as any)).toBe(false)
    expect(laminarEnabled({ LMNR_PROJECT_API_KEY: "k" } as any)).toBe(true)
  })
})

describe("withSpan exactly-once", () => {
  test("fn error propagates after exactly one call (no key)", async () => {
    let calls = 0
    const boom = async () => { calls++; throw new Error("fn-bad") }
    await expect(withSpan("t", {}, boom, {} as any)).rejects.toThrow("fn-bad")
    expect(calls).toBe(1)
  })
  test("fn error propagates after exactly one call (bogus key, init fails)", async () => {
    let calls = 0
    const boom = async () => { calls++; throw new Error("fn-bad") }
    await expect(
      withSpan("t", {}, boom, { LMNR_PROJECT_API_KEY: "bogus" } as any),
    ).rejects.toThrow("fn-bad")
    expect(calls).toBe(1)
  })
  test("success returns value, single call", async () => {
    let calls = 0
    const ok = async () => { calls++; return 42 }
    expect(await withSpan("t", {}, ok, {} as any)).toBe(42)
    expect(calls).toBe(1)
  })
})

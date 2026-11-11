import { describe, expect, test } from "bun:test"
import { isRateLimited, keysFor, laneKeys } from "../scripts/keys"

describe("laneKeys", () => {
  test("canonical names by default", () => {
    expect(laneKeys({ OPENCODE_API_KEY: "a" } as any)).toEqual({ fast: "a", bulk: "" })
    expect(laneKeys({ OPENCODE_API_KEY: "a", OPENCODE_API_KEY_BULK: "b" } as any)).toEqual({ fast: "a", bulk: "b" })
  })
  test("LLM_API_KEY is a fast-lane alias", () => {
    expect(laneKeys({ LLM_API_KEY: "l" } as any).fast).toBe("l")
  })
  test("explicit KEY_FAST/KEY_BULK override canonical names", () => {
    const r = laneKeys({ OPENCODE_API_KEY: "a", OPENCODE_API_KEY_BULK: "b", KEY_FAST: "f", KEY_BULK: "g" } as any)
    expect(r).toEqual({ fast: "f", bulk: "g" })
  })
  test("empty env gives empty lanes", () => {
    expect(laneKeys({} as any)).toEqual({ fast: "", bulk: "" })
  })
})

describe("keysFor", () => {
  const env = { OPENCODE_API_KEY: "a", OPENCODE_API_KEY_BULK: "b" } as any
  test("short: fast first, bulk as fallback", () => {
    expect(keysFor(env, "short")).toEqual({ primary: "a", fallback: "b" })
  })
  test("long: bulk only (strict isolation, no failover to fast)", () => {
    expect(keysFor(env, "long")).toEqual({ primary: "b", fallback: "" })
  })
  test("long without bulk configured falls back to fast (bootstrap)", () => {
    expect(keysFor({ OPENCODE_FEATURE_X: "?" } as any, "long")).toEqual({ primary: "", fallback: "" })
    expect(keysFor({ OPENCODE_API_KEY: "a" } as any, "long")).toEqual({ primary: "a", fallback: "" })
  })
  test("short with only bulk configured still works", () => {
    expect(keysFor({ OPENCODE_API_KEY_BULK: "b" } as any, "short")).toEqual({ primary: "", fallback: "b" })
  })
})

describe("isRateLimited", () => {
  test("matches 429 status in gh-style errors", () => {
    expect(isRateLimited(new Error("jev: 429 {quota exceeded}"))).toBe(true)
    expect(isRateLimited("HTTP 429 Too Many Requests")).toBe(true)
    expect(isRateLimited(new Error("gh /x: 429 whatever"))).toBe(true)
  })
  test("matches rate-limit phrases", () => {
    expect(isRateLimited("Rate limit exceeded, try later")).toBe(true)
    expect(isRateLimited("quota exceeded for free tier")).toBe(true)
  })
  test("does not match other errors", () => {
    expect(isRateLimited(new Error("jev: 403 Forbidden"))).toBe(false)
    expect(isRateLimited(new Error("jev: 401 Unauthorized"))).toBe(false)
    expect(isRateLimited(new Error("network unreachable"))).toBe(false)
    expect(isRateLimited(null)).toBe(false)
    expect(isRateLimited("")).toBe(false)
  })
})

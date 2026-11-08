import { describe, expect, test } from "bun:test"
import { cfConfigFromEnv } from "../scripts/cf-recall"

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

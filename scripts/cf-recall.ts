/**
 * CF backend for recall (#9): Workers AI bge-m3 embeddings + Vectorize.
 * Reads (all optional except token when mode=cf):
 *   CF_PARENT_TOKEN (org secret, required for cf mode)
 *   CF_ACCOUNT_ID (optional: auto-listed when missing)
 *   VECTORIZE_INDEX (default: opencode-intake)
 *   CF_EMBED_MODEL (default: @cf/baai/bge-m3)
 * Never throws to caller: on any error returns null -> caller falls back to keyword.
 */

export interface CfConfig {
  token: string
  accountId?: string
  index?: string
  embedModel?: string
}

export function cfConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CfConfig | null {
  const token = env.CF_PARENT_TOKEN ?? ""
  if (!token) return null
  return {
    token,
    accountId: env.CF_ACCOUNT_ID || undefined,
    index: env.VECTORIZE_INDEX || "opencode-intake",
    embedModel: env.CF_EMBED_MODEL || "@cf/baai/bge-m3",
  }
}

async function cfFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`cf ${path}: ${res.status}`)
  return res.json() as Promise<any>
}

export async function cfAccountId(cfg: CfConfig): Promise<string> {
  if (cfg.accountId) return cfg.accountId
  const data = await cfFetch("/accounts", cfg.token)
  const id = data?.result?.[0]?.id
  if (!id) throw new Error("cf: no account")
  return id as string
}

/** Embed texts via Workers AI. Returns one vector per text. */
export async function resolveAccountId(cfg: CfConfig): Promise<string> {
  if (cfg.accountId) return cfg.accountId
  const id = await cfAccountId(cfg)
  cfg.accountId = id
  return id
}

export async function cfEmbed(
  texts: string[],
  cfg: CfConfig,
  fetchFn: typeof fetch = fetch,
): Promise<number[][]> {
  const accountId = await resolveAccountId(cfg)
  const model = cfg.embedModel!
  // Child tokens need ~10s propagation; retry 401s briefly.
  let res: Response | null = null
  for (let i = 0; i < 5; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 10000))
    res = (await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: texts }),
    },
    )) as unknown as Response
    if (res.ok || res.status !== 401) break
  }
  const status = res?.status
  if (!res || !res.ok) throw new Error(`cf embed: ${status}`)
  const data = (await res.json()) as any
  const out = data?.result?.data ?? data?.result
  if (!Array.isArray(out)) throw new Error("cf embed: bad shape")
  return out as number[][]
}

/** Query Vectorize index for nearest candidates. Returns issue numbers (metadata) + scores. */
export async function cfQuery(
  vector: number[],
  cfg: CfConfig,
  topK = 10,
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ number: number; score: number }>> {
  const accountId = await resolveAccountId(cfg)
  const index = cfg.index!
  const res = await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${index}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vector, topK, returnMetadata: "all" }),
    },
  )
  if (!res.ok) throw new Error(`cf query: ${res.status}`)
  const data = (await res.json()) as any
  const matches = data?.result?.matches ?? []
  return matches
    .map((m: any) => ({ number: Number(m?.metadata?.issue ?? m?.id), score: m?.score ?? 0 }))
    .filter((m: any) => Number.isFinite(m.number))
}

/**
 * Mint an ephemeral least-privilege child token (strict).
 * Flow: parent -> list permission groups -> pick Vectorize Read + Workers AI Write
 * -> create token scoped to this account only, short TTL.
 * Returns null on ANY failure; caller must fall back to keyword and MUST NOT
 * use the parent token for data calls.
 */
export async function cfMintChild(
  cfg: CfConfig,
  ttlSeconds = 600,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const accountId = await cfAccountId(cfg)
    const gRes = await fetchFn("https://api.cloudflare.com/client/v4/user/tokens/permission_groups", {
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    })
    if (!gRes.ok) return null
    const groups = (((await gRes.json()) as any)?.result ?? []) as Array<{ id: string; name: string }>
    const want = ["Vectorize Read", "Workers AI Write"]
    const ids = want.map((n) => groups.find((g) => g.name === n)?.id).filter(Boolean) as string[]
    if (ids.length !== want.length) return null
    const noMs = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z")
    const now = new Date()
    const res = await fetchFn("https://api.cloudflare.com/client/v4/user/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "pm-intake-ephemeral",
        policies: [
          {
            effect: "allow",
            resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
            permission_groups: ids.map((id) => ({ id })),
          },
        ],
        expires_on: noMs(new Date(now.getTime() + ttlSeconds * 1000)),
        not_before: noMs(now),
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    return (data?.result?.value as string) ?? null
  } catch {
    return null
  }
}

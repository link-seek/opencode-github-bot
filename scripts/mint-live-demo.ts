const token = process.env.CF_PARENT_TOKEN!
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
const gs: any = await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/permission_groups", { headers: H })).json()
for (const g of (gs.result ?? []) as any[]) {
  if (/vectorize|workers ai/i.test(g.name)) console.log("-", g.name)
}

const token = process.env.CF_PARENT_TOKEN!
const j = async (u: string, init?: RequestInit) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${u}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
  const t = await r.text()
  return { status: r.status, body: t.slice(0, 200) }
}
const me = await j("/user/tokens/verify")
console.log("verify:", me.status, me.body)
const g = await j("/user/tokens/permission_groups")
console.log("groups:", g.status, g.body)

const token = process.env.CF_PARENT_TOKEN!
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
const gs: any = await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/permission_groups", { headers: H })).json()
const pick = (n: string) => (gs.result ?? []).find((g: any) => g.name === n)
const v = pick("Vectorize Read");
const w = pick("Workers AI Read");
console.log("want:", JSON.stringify({ v: v && { id: v.id, scopes: v.scopes }, w: w && { id: w.id, scopes: w.scopes } }))
if (!v || !w) { console.log("GROUPS_MISSING"); process.exit(0) }
const r = await fetch("https://api.cloudflare.com/client/v4/user/tokens", {
  method: "POST", headers: H,
  body: JSON.stringify({
    name: "pm-intake-ephemeral-probe",
    policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.*": { id: "*" } }, permission_groups: [{ id: v.id }, { id: w.id }] }],
    expires_on: new Date(Date.now() + 600000).toISOString(),
  }),
})
console.log("create:", r.status, (await r.text()).slice(0, 400))

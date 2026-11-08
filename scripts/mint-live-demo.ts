import { cfConfigFromEnv, cfMintChild, cfEmbed, resolveAccountId } from "./cf-recall"
const cfg = cfConfigFromEnv()
if (!cfg) { console.log("NO_CFG"); process.exit(0) }
await resolveAccountId(cfg)
const child = await cfMintChild(cfg, 600)
if (!child) { console.log("MINT_NULL_FALLBACK_KEYWORD"); process.exit(0) }
console.log(`MINT_OK len=${child.length}`)
const cc = { ...cfg, token: child }
for (let i = 0; i < 4; i++) {
  try {
    await new Promise((r) => setTimeout(r, 10000))
    const vecs = await cfEmbed(["probe: intake triage"], cc)
    console.log(`CHILD_EMBED_OK dims=${vecs[0].length} after=${(i + 1) * 10}s`)
    process.exit(0)
  } catch (e: any) {
    console.log(`try${i}: ${e.message}`)
  }
}
console.log("CHILD_EMBED_FAIL")

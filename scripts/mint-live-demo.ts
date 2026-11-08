import { cfConfigFromEnv, cfMintChild, cfEmbed, resolveAccountId } from "./cf-recall"
const cfg = cfConfigFromEnv()
if (!cfg) { console.log("NO_CFG"); process.exit(0) }
await resolveAccountId(cfg)
const child = await cfMintChild(cfg, 600)
if (!child) { console.log("MINT_NULL_FALLBACK_KEYWORD"); process.exit(0) }
console.log(`MINT_OK len=${child.length}`)
const vecs = await cfEmbed(["probe: intake triage"], { ...cfg, token: child })
console.log(`CHILD_EMBED_OK dims=${vecs[0].length}`)

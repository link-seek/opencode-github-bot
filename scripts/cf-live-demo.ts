// One-off live demo: CF_PARENT_TOKEN -> account -> bge-m3 embed 2 texts -> cosine.
// Read-only except embedding inference (no writes, no index needed).
import { cfConfigFromEnv, cfAccountId, cfEmbed } from "./cf-recall"
import { vectorCosine } from "./recall"

const cfg = cfConfigFromEnv()
if (!cfg) {
  console.log("SKIP: no CF_PARENT_TOKEN in env")
  process.exit(0)
}
const account = await cfAccountId(cfg)
console.log(`account: ${account.slice(0, 6)}… model: ${cfg.embedModel}`)
const vecs = await cfEmbed(
  ["fix: resolve issue #12, commit and push branch", "docs: update README usage section"],
  cfg,
)
console.log(`dims: ${vecs[0].length}, cosine(similar pair check): ${vectorCosine(vecs[0], vecs[0]).toFixed(4)}`)
console.log("LIVE_OK")

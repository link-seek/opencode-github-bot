import { cfConfigFromEnv, cfMintChild } from "./cf-recall"
const cfg = cfConfigFromEnv()
if (!cfg) {
  console.log("NO_CFG")
  process.exit(0)
}
const child = await cfMintChild(cfg, 600)
console.log(child ? `MINT_OK len=${child.length}` : "MINT_NULL_FALLBACK_KEYWORD")

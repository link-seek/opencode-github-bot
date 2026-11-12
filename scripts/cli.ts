#!/usr/bin/env bun
import { runInit, listMissing } from "./init"

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0] || "help"
  if (cmd === "init") {
    const write = !args.includes("--dry-run")
    const force = args.includes("--force")
    const cwd = process.cwd()
    const res = await runInit({ cwd, write, force })
    process.stdout.write(res.content)
    if (res.missing.length > 0) {
      console.error("\nMissing required configuration:")
      for (const m of res.missing) console.error("  - " + m)
      console.error("\nAdd them in repo/org Settings -> Secrets and variables -> Actions.")
      process.exitCode = 1
    } else {
      console.error("\nBot configuration OK.")
    }
    if (res.written) console.error(`Wrote ${res.workflowPath}`)
    return
  }
  if (cmd === "check") {
    const missing = listMissing(process.env as any)
    if (missing.length > 0) {
      console.error("Missing:")
      for (const m of missing) console.error("  - " + m)
      process.exit(1)
    }
    console.log("OK")
    return
  }
  console.log("Usage: opencode-github-bot init [--dry-run] [--force]")
  console.log("       opencode-github-bot check")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
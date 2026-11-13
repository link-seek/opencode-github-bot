#!/usr/bin/env node
import { runInit, listMissing, runUpgrade } from "./init.js"

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0] || "help"
  if (cmd === "init" && args[1] === "upgrade") {
    const version = args[2]
    const write = !args.includes("--dry-run")
    const dryRun = args.includes("--dry-run")
    const cwd = process.cwd()
    const res = await runUpgrade({ cwd, version, write, dryRun })
    console.error(`Upgrade to ${res.version}: ${res.replacements} replacement(s) in ${res.changedFiles.length} file(s).`)
    for (const f of res.changedFiles) console.error("  - " + f)
    if (res.remaining.length > 0) {
      console.error("\nResidual references:")
      for (const r of res.remaining) console.error("  - " + r)
      process.exitCode = 1
      return
    }
    console.error(res.validated ? "\nValidation OK." : "\nValidation failed.")
    if (!res.validated) process.exitCode = 1
    return
  }
  if (cmd === "init") {
    const write = !args.includes("--dry-run")
    const force = args.includes("--force")
    const cwd = process.cwd()
    const res = await runInit({ cwd, write, force })
    process.stdout.write(res.content)
    if (res.error) {
      console.error(`\nWrite failed: ${res.error}`)
      process.exitCode = 1
      return
    }
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
  if (cmd === "upgrade") {
    const version = args[1]
    const dryRun = args.includes("--dry-run")
    const cwd = process.cwd()
    const res = await runUpgrade({ cwd, version, dryRun })
    console.error(`Upgrade to ${res.version}: ${res.replacements} replacement(s) in ${res.changedFiles.length} file(s).`)
    for (const f of res.changedFiles) console.error("  - " + f)
    if (res.remaining.length > 0) {
      console.error("\nResidual references:")
      for (const r of res.remaining) console.error("  - " + r)
      process.exitCode = 1
      return
    }
    if (!res.validated) process.exitCode = 1
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
  console.log("       opencode-github-bot init upgrade <version> [--dry-run]")
  console.log("       opencode-github-bot upgrade <version> [--dry-run]")
  console.log("       opencode-github-bot check")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
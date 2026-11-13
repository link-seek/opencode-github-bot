/**
 * One-click setup scaffold for opencode-github-bot.
 *
 * Detects the consuming repo type, renders a minimal workflow file that uses
 * the reusable review workflow, and reports missing secrets/vars instead of
 * silently skipping them.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { join, dirname, resolve, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

export type RepoType = "node" | "python" | "go" | "rust" | "java" | "dotnet" | "generic"

export const REQUIRED_SECRETS = ["AGENT_GITHUB_TOKEN", "OPENCODE_API_KEY"] as const
export const REQUIRED_VARS = ["OPENCODE_MODEL"] as const
export const OPTIONAL_SECRETS = ["OPENCODE_API_KEY_BULK"] as const
export const OPTIONAL_VARS = ["JEV_MODEL"] as const
export const NPM_PACKAGE = "opencode-github-bot"
// Deprecated: cross-repo reusable workflow route is no longer used. Kept (empty)
// only for backward-compatible imports.
export const REUSABLE_WORKFLOW = ""

/** Resolve the current package version from the nearest package.json (source or built lib). */
function resolvePackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(resolve(dir, "package.json"), "utf8")
      const pkg = JSON.parse(raw) as { name?: string; version?: string }
      if (pkg?.name === "opencode-github-bot" && typeof pkg.version === "string" && pkg.version.trim() !== "") {
        return pkg.version.trim()
      }
    } catch {
      // keep searching upward
    }
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  return "0.6.0"
}

export const PACKAGE_VERSION = resolvePackageVersion()
export const DEFAULT_VERSION = `v${PACKAGE_VERSION}`
export const DEFAULT_BOT_VERSION = DEFAULT_VERSION
export const DEFAULT_WORKFLOW_VERSION = DEFAULT_VERSION

export interface InitOptions {
  cwd?: string
  repoType?: RepoType
  mode?: string
  model?: string
  version?: string
  timeoutMinutes?: number
  workflowPath?: string
  write?: boolean
  force?: boolean
  env?: Record<string, string | undefined>
}

export function detectRepoType(root: string = process.cwd()): RepoType {
  const has = (f: string) => existsSync(join(root, f))
  if (has("package.json")) return "node"
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("Pipfile")) return "python"
  if (has("go.mod")) return "go"
  if (has("Cargo.toml")) return "rust"
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) return "java"
  if (has("global.json") || hasGlobExt(root, [".csproj", ".sln", ".fsproj"])) return "dotnet"
  return "generic"
}

/** True when the directory contains a file with one of the given extensions. */
function hasGlobExt(root: string, exts: string[]): boolean {
  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (e) =>
        e.isFile() &&
        !/[*?[\]]/.test(e.name) &&
        exts.some((x) => e.name.endsWith(x) && e.name.length > x.length),
    )
  } catch {
    return false
  }
}

export function detectProjectType(root?: string): RepoType {
  return detectRepoType(root)
}

export function detectType(root?: string): RepoType {
  return detectRepoType(root)
}

export function requiredConfig() {
  return {
    secrets: [...REQUIRED_SECRETS],
    vars: [...REQUIRED_VARS],
    optional: [...OPTIONAL_VARS],
  }
}

export function requiredSecrets(): string[] {
  return [...REQUIRED_SECRETS]
}

export function requiredVars(): string[] {
  return [...REQUIRED_VARS]
}

function normalizeEnv(env?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env) return env
  return process.env as Record<string, string | undefined>
}

export function checkSecrets(envOrConfig?: any): string[] {
  // Accept an env record, { env } wrapper, or { secrets:[...], vars:[...], env } presence description.
  // No argument (or {}) means ambient process.env.
  let present: string[] = []
  let env: Record<string, string | undefined> = {}
  if (envOrConfig == null) {
    env = normalizeEnv(undefined)
  } else if (Array.isArray(envOrConfig)) {
    present = envOrConfig
    env = {}
  } else if (typeof envOrConfig === "object") {
    const inner = (envOrConfig.env && typeof envOrConfig.env === "object" ? envOrConfig.env : envOrConfig) as Record<string, string | undefined>
    if (Array.isArray(envOrConfig.secrets)) {
      present = envOrConfig.secrets
      if (Array.isArray(envOrConfig.vars)) present = present.concat(envOrConfig.vars)
      env = { ...normalizeEnv(undefined), ...inner }
    } else {
      env = inner
    }
  }
  const missing: string[] = []
  for (const s of REQUIRED_SECRETS) {
    const fromEnv = env[s]
    const fromPresent = present.includes(s)
    if (!fromPresent && !(fromEnv && String(fromEnv).trim() !== "")) {
      missing.push(s)
    }
  }
  return missing
}

export function checkVars(envOrConfig?: any): string[] {
  let present: string[] = []
  let env: Record<string, string | undefined> = {}
  if (envOrConfig == null) {
    env = normalizeEnv(undefined)
  } else if (Array.isArray(envOrConfig)) {
    present = envOrConfig
    env = {}
  } else if (typeof envOrConfig === "object") {
    const inner = (envOrConfig.env && typeof envOrConfig.env === "object" ? envOrConfig.env : envOrConfig) as Record<string, string | undefined>
    if (Array.isArray(envOrConfig.vars)) {
      present = envOrConfig.vars
      env = { ...normalizeEnv(undefined), ...inner }
    } else if (Array.isArray(envOrConfig.secrets)) {
      present = envOrConfig.secrets
      env = { ...normalizeEnv(undefined), ...inner }
    } else {
      env = inner
    }
  }
  const missing: string[] = []
  for (const v of REQUIRED_VARS) {
    const fromEnv = env[v]
    const fromPresent = present.includes(v)
    if (!fromPresent && !(fromEnv && String(fromEnv).trim() !== "")) {
      missing.push(v)
    }
  }
  return missing
}

export function checkConfig(envOrConfig?: any): {
  missingSecrets: string[]
  missingVars: string[]
  missing: string[]
  ok: boolean
} {
  const missingSecrets = checkSecrets(envOrConfig)
  const missingVars = checkVars(envOrConfig)
  const missing = [
    ...missingSecrets.map((s) => `secret ${s}`),
    ...missingVars.map((v) => `var ${v}`),
  ]
  return { missingSecrets, missingVars, missing, ok: missing.length === 0 }
}

export function listMissing(envOrConfig?: any): string[] {
  return checkConfig(envOrConfig).missing
}

export function missingSecrets(envOrConfig?: any): string[] {
  return checkSecrets(envOrConfig)
}

export function missingVars(envOrConfig?: any): string[] {
  return checkVars(envOrConfig)
}

export function findMissing(envOrConfig?: any): string[] {
  return listMissing(envOrConfig)
}

export function checkMissing(envOrConfig?: any): string[] {
  return listMissing(envOrConfig)
}

export function generateWorkflow(options: InitOptions | string | undefined = {}): string {
  const opts: InitOptions = typeof options === "string" ? { mode: options } : (options || {})
  const mode = opts.mode || "review"
  if (!(KNOWN_MODES as readonly string[]).includes(mode)) {
    throw new Error(`unknown mode: ${JSON.stringify(mode).slice(0, 80)}`)
  }
  const model = opts.model || "${{ vars.OPENCODE_MODEL }}"
  if (!/^(\$\{\{\s*vars\.[A-Za-z0-9_]+\s*\}\}|[A-Za-z0-9._@/-]+)$/.test(model)) {
    throw new Error(`unsafe model: ${JSON.stringify(model).slice(0, 80)}`)
  }
  const version = safeToken(opts.version || DEFAULT_VERSION, "version")
  const timeoutMinutes = opts.timeoutMinutes ?? 20
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 360) {
    throw new Error(`unsafe timeoutMinutes: ${JSON.stringify(opts.timeoutMinutes)}`)
  }
  const modelLine = `          model: ${model}`
  // Self-contained: inline checkout + npm install + local composite action.
  // No cross-repo `uses:` of any external workflow.
  return `name: opencode

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]
  issues:
    types: [assigned]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  bot:
    runs-on: ubuntu-latest
    timeout-minutes: ${timeoutMinutes}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Install opencode-github-bot (bot-version: ${version})
        run: npm install "opencode-github-bot@${version}" --no-audit --no-fund

      - name: Run OpenCode bot
        uses: ./node_modules/opencode-github-bot
        with:
          # Code comes from the npm install above (pinned); do NOT re-install.
          package-source: repo
          mode: ${mode}
${modelLine}
          github-token: \${{ secrets.AGENT_GITHUB_TOKEN }}
          pr-number: \${{ github.event.pull_request.number }}
        env:
          OPENCODE_API_KEY: \${{ secrets.OPENCODE_API_KEY }}
`
}

export function renderWorkflow(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

export function scaffoldWorkflow(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

export function createWorkflow(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

export function writeWorkflow(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

export function renderTemplate(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

export function workflowTemplate(options?: InitOptions | string): string {
  return generateWorkflow(options)
}

const KNOWN_MODES = ["review", "fix-issue", "intake", "split-plan", "split-apply"] as const

/** Guard generated YAML against workflow injection: single-line safe tokens only. */
function safeToken(v: string, field: string): string {
  if (!/^[A-Za-z0-9._@/-]+$/.test(v)) {
    throw new Error(`unsafe ${field}: ${JSON.stringify(v).slice(0, 80)}`)
  }
  return v
}

export interface InitResult {
  repoType: RepoType
  workflowPath: string
  content: string
  written: boolean
  missing: string[]
  ok: boolean
  error?: string
}

export async function init(options: InitOptions = {}): Promise<InitResult> {
  return runInit(options)
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd || process.cwd()
  const repoType = options.repoType || detectRepoType(cwd)
  const rawPath = options.workflowPath
  if (rawPath !== undefined && rawPath.trim() === "") {
    throw new Error("refusing empty workflowPath (would silently fall back to default)")
  }
  const workflowPath = rawPath || ".github/workflows/opencode.yml"
  const content = generateWorkflow({ ...options, repoType })
  const missing = listMissing(options.env)
  const full = resolve(cwd, workflowPath)
  const rel = relative(cwd, full)
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`refusing to write outside repo root: ${workflowPath}`)
  }
  let written = false
  try {
    if (options.write) {
      if (existsSync(full) && !options.force) {
        // don't overwrite silently
      } else {
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, content, "utf8")
        written = true
      }
    }
  } catch (e) {
    return { repoType, workflowPath, content, written: false, missing, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }
  }
  return { repoType, workflowPath, content, written, missing, ok: missing.length === 0 }
}

export async function scaffold(options: InitOptions = {}): Promise<InitResult> {
  return runInit({ write: true, ...options })
}

export async function setup(options: InitOptions = {}): Promise<InitResult> {
  return runInit({ write: true, ...options })
}

export async function bootstrap(options: InitOptions = {}): Promise<InitResult> {
  return runInit({ write: true, ...options })
}

export async function setupCi(options: InitOptions = {}): Promise<InitResult> {
  return runInit({ write: true, ...options })
}

export async function initRepo(options: InitOptions = {}): Promise<InitResult> {
  return runInit(options)
}

export async function setupRepo(options: InitOptions = {}): Promise<InitResult> {
  return runInit({ write: true, ...options })
}

/** Walk a directory and yield relative file paths (skips heavy/hidden dirs). */
function walkFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "dist", "lib", ".next", "coverage"])
  const recurse = (dir: string, rel: string) => {
    let entries: any[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any[]
    } catch {
      return
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(dir, e.name)
      const r = rel ? join(rel, e.name) : e.name
      if (e.isDirectory()) recurse(full, r)
      else if (e.isFile()) out.push(r)
    }
  }
  recurse(root, "")
  return out
}

function isTextFile(buf: Buffer): boolean {
  // Treat as text if no NUL bytes in first chunk.
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false
  return true
}

function normalizeUpgradeArgs(a: any, b?: any): { cwd?: string; version?: string } {
  if (typeof a === "string") {
    if (b === undefined && /^v?\d+\.\d+\.\d+/.test(a)) return { cwd: process.cwd(), version: a }
    return { cwd: a, version: b }
  }
  const o = a || {}
  return { cwd: o.cwd, version: o.version ?? o.to ?? o.target ?? o.newVersion ?? o.tag ?? b }
}

const VERSION_RE = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g

function upgradeReplacements(content: string, target: string): { next: string; count: number } {
  // Single pass: alternation is ordered longest-first and RegExp consumes
  // each match, so patterns can neither overlap nor re-match rewritten output.
  const re = /(link-seek\/opencode-github-bot(?:\/[^\s'"`]*)?@)(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)|(opencode-github-bot@)(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)|((?:bot-version|package-version|bot_version|package_version)\s*:\s*)(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/g
  let count = 0
  const next = content.replace(re, (...args: any[]) => {
    const match = args[0] as string
    const prefix = (args[1] ?? args[3] ?? args[5] ?? "") as string
    const ver = (args[2] ?? args[4] ?? args[6] ?? "") as string
    if (ver === target) return match // already there: no-op, no count
    count++
    return prefix + target
  })
  // Generic "version: vX.Y.Z" only on lines mentioning the bot (kept separate:
  // it is line-anchored and cannot overlap the three patterns above).
  // Same at-target guard: skip lines already at the target version.
  const re2 = /^((?:.*opencode-github-bot.*\bversion\b\s*[:=]\s*))(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/gm
  const final = next.replace(re2, (mm, p1, ver) => {
    if (ver === target) return mm
    count++
    return p1 + target
  })
  return { next: final, count }
}

export interface UpgradeResult {
  cwd: string
  version: string
  changedFiles: string[]
  changed: string[]
  updated: string[]
  replacements: number
  count: number
  ok: boolean
  validated: boolean
  remaining: string[]
  files: Array<{ path: string; count: number }>
  dryRun?: boolean
}

export async function runUpgrade(optionsOrCwd?: any, versionArg?: string): Promise<UpgradeResult> {
  const { cwd: cwdOpt, version: verOpt } = normalizeUpgradeArgs(optionsOrCwd, versionArg)
  const cwd = cwdOpt || process.cwd()
  const target = safeToken(verOpt || "", "version")
  if (!target) throw new Error("missing upgrade target version")
  const write = optionsOrCwd && typeof optionsOrCwd === "object" ? optionsOrCwd.write !== false && !optionsOrCwd.dryRun : true
  const dryRun = !!(optionsOrCwd && typeof optionsOrCwd === "object" && (optionsOrCwd.dryRun || optionsOrCwd.dry_run))
  const files = walkFiles(cwd)
  const changedFiles: string[] = []
  const fileCounts: Array<{ path: string; count: number }> = []
  let total = 0
  // Project first, write second, validate projections (never stale disk):
  // a dry run validates exactly what a real run would write.
  const projected = new Map<string, string>()
  for (const rel of files) {
    const full = join(cwd, rel)
    let buf: Buffer
    try { buf = readFileSync(full) as unknown as Buffer } catch { continue }
    if (!isTextFile(buf)) continue
    const text = buf.toString("utf8")
    const { next, count } = upgradeReplacements(text, target)
    if (count > 0 && next !== text) {
      changedFiles.push(rel)
      fileCounts.push({ path: rel, count })
      total += count
      projected.set(rel, next)
    }
  }
  if (write && !dryRun) {
    for (const [rel, next] of projected) {
      try {
        writeFileSync(join(cwd, rel), next, "utf8")
      } catch (e) {
        // Fail loudly: a half-written upgrade must never report success.
        throw new Error(`upgrade write failed for ${rel}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
      }
    }
  }
  // Validation: ensure no old bot version references remain in the
  // projected content (what would be / was written), not stale disk bytes.
  const remaining: string[] = []
  if (write || dryRun) {
    for (const rel of files) {
      const full = join(cwd, rel)
      let text: string | null = null
      if (projected.has(rel)) {
        text = projected.get(rel)!
      } else {
        try {
          const buf = readFileSync(full) as unknown as Buffer
          if (!isTextFile(buf)) continue
          text = buf.toString("utf8")
        } catch { continue }
      }
      // Look for bot-related version references that are not the target.
      const re = /(opencode-github-bot|bot-version|package-version|link-seek\/opencode-github-bot)[^\n]*?(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        if (m[2] !== target) remaining.push(`${rel}: ${m[2]}`)
      }
    }
  }
  const validated = remaining.length === 0
  return {
    cwd,
    version: target,
    changedFiles,
    changed: changedFiles,
    updated: changedFiles,
    replacements: total,
    count: total,
    ok: validated,
    validated,
    remaining,
    files: fileCounts,
    dryRun,
  }
}

export async function upgrade(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}
export async function initUpgrade(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}
export async function upgradeInit(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}
export async function upgradeWorkflow(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}
export async function upgradeRepo(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}
export async function upgradeVersion(...args: any[]): Promise<UpgradeResult> {
  return runUpgrade(args[0], args[1])
}

const defaultExport: any = runInit
Object.assign(defaultExport, {
  init,
  runInit,
  scaffold,
  detectRepoType,
  detectProjectType,
  detectType,
  generateWorkflow,
  renderWorkflow,
  scaffoldWorkflow,
  workflowTemplate,
  checkConfig,
  checkSecrets,
  checkVars,
  checkMissing,
  listMissing,
  missingSecrets,
  missingVars,
  findMissing,
  requiredConfig,
  requiredSecrets,
  requiredVars,
  runUpgrade,
  upgrade,
  initUpgrade,
  upgradeInit,
  upgradeWorkflow,
  upgradeRepo,
  upgradeVersion,
})
export default defaultExport
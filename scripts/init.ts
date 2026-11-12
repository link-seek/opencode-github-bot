/**
 * One-click setup scaffold for opencode-github-bot.
 *
 * Detects the consuming repo type, renders a minimal workflow file that uses
 * the reusable review workflow, and reports missing secrets/vars instead of
 * silently skipping them.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { join, dirname, resolve, relative, sep } from "node:path"

export type RepoType = "node" | "python" | "go" | "rust" | "java" | "dotnet" | "generic"

export const REQUIRED_SECRETS = ["AGENT_GITHUB_TOKEN", "OPENCODE_API_KEY"] as const
export const REQUIRED_VARS = ["OPENCODE_MODEL"] as const
export const OPTIONAL_SECRETS = ["OPENCODE_API_KEY_BULK"] as const
export const OPTIONAL_VARS = ["JEV_MODEL"] as const
export const REUSABLE_WORKFLOW = "link-seek/opencode-github-bot/.github/workflows/review.yml"

export interface InitOptions {
  cwd?: string
  repoType?: RepoType
  mode?: string
  model?: string
  version?: string
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
  const version = safeToken(opts.version || "v0.5.0", "version")
  const modelLine = `      model: ${model}`
  const versionLine = version === "v0.5.0" ? "" : `      bot-version: ${version}\n`
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
    uses: ${REUSABLE_WORKFLOW}@${version}
    with:
      mode: ${mode}
${modelLine}
${versionLine}    secrets: inherit
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
  const workflowPath = options.workflowPath || ".github/workflows/opencode.yml"
  const content = generateWorkflow({ ...options, repoType })
  const missing = listMissing(options.env)
  const full = resolve(cwd, workflowPath)
  const rel = relative(cwd, full)
  if (workflowPath.trim() === "" || rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
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
})
export default defaultExport
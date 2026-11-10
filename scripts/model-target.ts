/**
 * ONE variable carries BOTH formats: "<cli-model> <api-base-url>".
 *  - CLI (`opencode run --model`): first token, used as-is.
 *  - API: base URL = second token; model id = part after the last "/".
 * Examples:
 *  - "opencode-go/beam-free https://opencode.ai/inference/openai/v1"
 *  - "jev-1.13-free https://opencode.ai/inference/systemone/v1/systemone"
 *  - "jev-1.13-free https://opencode.ai/zen/v1/systemone"
 * Single token (legacy) = CLI form; API base falls back to caller default.
 * Switching models = editing the variable only. No code changes, no tables.
 */

export interface ModelVar {
  cli: string
  apiBase: string
  apiId: string
}

/** Split "<cli> <base>" (extra whitespace tolerated). */
export function parseModelVar(raw: string): ModelVar {
  const parts = (raw || "").trim().split(/\s+/)
  const cli = parts[0] || ""
  const apiBase = parts[1] || ""
  const slash = cli.lastIndexOf("/")
  const apiId = slash >= 0 ? cli.slice(slash + 1).trim() : cli
  if (!apiId) return { cli: "", apiBase: "", apiId: "" }
  return { cli, apiBase, apiId }
}

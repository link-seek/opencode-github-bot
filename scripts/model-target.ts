/**
 * ONE variable carries BOTH formats, as JSON:
 *   {"cli":"opencode-go/beam-free","apiBase":"https://opencode.ai/inference/openai/v1"}
 *  - CLI (`opencode run --model`): `cli` verbatim.
 *  - API: `apiBase` endpoint + model id (`apiId` if given, else part after last "/").
 * Legacy "single token" / "cli base" space-separated values still parse
 * (treated as cli form; base falls back to caller default).
 * Switching models = editing the variable only. No code changes, no tables.
 */

export interface ModelVar {
  cli: string
  apiBase: string
  apiId: string
}

/** Parse the variable: JSON first, legacy space-separated second. */
export function parseModelVar(raw: string): ModelVar {
  const t = (raw || "").trim()
  if (!t) return { cli: "", apiBase: "", apiId: "" }
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as { cli?: unknown; apiBase?: unknown; apiId?: unknown }
      const cli = typeof o.cli === "string" ? o.cli.trim() : ""
      if (!cli) return { cli: "", apiBase: "", apiId: "" }
      const apiBase = typeof o.apiBase === "string" ? o.apiBase.trim() : ""
      const apiId =
        typeof o.apiId === "string" && o.apiId.trim()
          ? o.apiId.trim()
          : cli.slice(cli.lastIndexOf("/") + 1).trim()
      if (!apiId) return { cli: "", apiBase: "", apiId: "" }
      return { cli, apiBase, apiId }
    } catch {
      return { cli: "", apiBase: "", apiId: "" }
    }
  }
  const parts = t.split(/\s+/)
  const cli = (parts[0] || "").trim()
  const apiBase = (parts[1] || "").trim()
  const apiId = cli.slice(cli.lastIndexOf("/") + 1).trim()
  if (!apiId) return { cli: "", apiBase: "", apiId: "" }
  return { cli, apiBase, apiId }
}

/**
 * ONE variable carries BOTH formats, as JSON:
 *   {"cli":"opencode-go/beam-free","apiBase":"https://opencode.ai/inference/openai/v1"}
 *  - CLI (`opencode run --model`): `cli` verbatim.
 *  - API: `apiBase` endpoint + model id (`apiId` if given, else part after last "/").
 * Legacy "single token" / "cli base" space-separated values still parse
 * (treated as cli form; base falls back to caller default).
 * Switching models = editing the variable only. No code changes, no tables.
 *
 * Dual-value (primary + fallback) for lane-internal fallback (#120):
 *   {"cli":"<primary>","apiBase":"<base>","fallback_cli":"<backup>","fallback_apiBase":"<base>"}
 *  - No `fallback_cli` (empty/missing) = no fallback; behavior is exactly the
 *    old single-model path. Old形状 (no fallback fields) keeps working so
 *    vars/code can roll out independently without breaking dogfood.
 *  - Optional `fallback_apiId`: when set it wins for the fallback API id,
 *    else it derives from the part after the last "/" of `fallback_cli`.
 *  - Fallback NEVER changes keys/lanes: it only swaps the model on the SAME
 *    key. Lane failover (short fast->bulk) still applies afterwards.
 */

export interface ModelTarget {
  cli: string
  apiBase: string
  apiId: string
}

/** Parsed variable: primary target + optional fallback target (same key). */
export interface ModelVar extends ModelTarget {
  fallbackCli: string
  fallbackApiBase: string
  fallbackApiId: string
}

const EMPTY: ModelVar = { cli: "", apiBase: "", apiId: "", fallbackCli: "", fallbackApiBase: "", fallbackApiId: "" }

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** Parse the variable: JSON first, legacy space-separated second. */
export function parseModelVar(raw: string): ModelVar {
  const t = (raw || "").trim()
  if (!t) return { ...EMPTY }
  if (t.startsWith("{")) {
    try {
      const o: unknown = JSON.parse(t)
      if (typeof o !== "object" || o === null) return { ...EMPTY }
      const rec = o as Record<string, unknown>
      const cli = str(rec.cli)
      if (!cli) return { ...EMPTY }
      const apiBase = str(rec.apiBase)
      const apiId = str(rec.apiId) || cli.slice(cli.lastIndexOf("/") + 1).trim()
      if (!apiId) return { ...EMPTY }
      const fallbackCli = str(rec.fallback_cli)
      if (!fallbackCli) return { cli, apiBase, apiId, fallbackCli: "", fallbackApiBase: "", fallbackApiId: "" }
      const fallbackApiBase = str(rec.fallback_apiBase)
      const fallbackApiId = str(rec.fallback_apiId) || fallbackCli.slice(fallbackCli.lastIndexOf("/") + 1).trim()
      if (!fallbackApiId) return { cli, apiBase, apiId, fallbackCli: "", fallbackApiBase: "", fallbackApiId: "" }
      return { cli, apiBase, apiId, fallbackCli, fallbackApiBase, fallbackApiId }
    } catch {
      return { ...EMPTY }
    }
  }
  const parts = t.split(/\s+/)
  const cli = (parts[0] || "").trim()
  const apiBase = (parts[1] || "").trim()
  const apiId = cli.slice(cli.lastIndexOf("/") + 1).trim()
  if (!apiId) return { ...EMPTY }
  return { cli, apiBase, apiId, fallbackCli: "", fallbackApiBase: "", fallbackApiId: "" }
}

/** Ordered API/CLI targets to try on the SAME key: primary first, then fallback. */
export function modelTargets(v: ModelVar): ModelTarget[] {
  const primary: ModelTarget = { cli: v.cli, apiBase: v.apiBase, apiId: v.apiId }
  if (!v.fallbackCli || !v.fallbackApiId) return [primary]
  return [primary, { cli: v.fallbackCli, apiBase: v.fallbackApiBase, apiId: v.fallbackApiId }]
}

/** Parse + expand in one call. Empty/invalid -> []. */
export function parseModelTargets(raw: string): ModelTarget[] {
  const v = parseModelVar(raw)
  if (!v.apiId) return []
  return modelTargets(v)
}

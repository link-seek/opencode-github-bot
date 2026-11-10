/**
 * Unified model value parser: ONE variable drives both CLI and API calls.
 * Convention (same as JEV_MODEL): "provider/model-id".
 *  - CLI (`opencode run --model`): use the raw value as-is.
 *  - API (chat completions): split provider -> base URL table, send bare id.
 * Unknown provider -> caller fallback (env override or default).
 */

export const PROVIDER_API_BASE_URL: Record<string, string> = {
  "opencode-go": "https://opencode.ai/inference/openai/v1",
  "opencode": "https://opencode.ai/inference/openai/v1",
}

export interface ApiTarget {
  provider: string
  model: string
  baseUrl: string | null
}

/** Split "provider/id" (CLI form) into provider + bare API model id. */
export function splitModelTarget(raw: string): { provider: string; model: string } {
  const m = (raw || "").trim()
  const i = m.indexOf("/")
  if (i <= 0 || i === m.length - 1) return { provider: "", model: m }
  const provider = m.slice(0, i).trim()
  const model = m.slice(i + 1).trim()
  if (!provider || !model) return { provider: "", model: m }
  return { provider, model }
}

/** Resolve an API target: provider table first, then caller fallback base URL. */
export function apiTargetFor(raw: string, fallbackBaseUrl = ""): ApiTarget {
  const { provider, model } = splitModelTarget(raw)
  const baseUrl = (provider && PROVIDER_API_BASE_URL[provider]) || fallbackBaseUrl || null
  return { provider, model, baseUrl }
}

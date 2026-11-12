/**
 * Laminar tracing helper (#79).
 *
 * Wraps @lmnr-ai/lmnr (OTLP) so that the rest of the bot can emit spans
 * without caring whether tracing is configured. Missing key or missing SDK
 * => silent no-op. Tracing never blocks or breaks the main flow.
 */
export type TraceAttrs = Record<string, unknown>

export function laminarApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env?.LMNR_PROJECT_API_KEY ?? "").trim()
}

export function laminarEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return laminarApiKey(env).length > 0
}

// Back-compat aliases
export const traceEnabled = laminarEnabled
export const hasLaminarKey = laminarEnabled
export const isTracingEnabled = laminarEnabled
export const hasTraceKey = laminarEnabled

let initialized = false
let initFailed = false

export async function initLaminar(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (initialized) return true
  if (initFailed) return false
  const key = laminarApiKey(env)
  if (!key) return false
  try {
    const mod: any = await import("@lmnr-ai/lmnr")
    const Laminar = mod?.Laminar ?? mod?.default?.Laminar
    if (!Laminar || typeof Laminar.initialize !== "function") {
      initFailed = true
      return false
    }
    Laminar.initialize({ projectApiKey: key, logLevel: "error" })
    initialized = true
    return true
  } catch {
    initFailed = true
    return false
  }
}

// aliases
export const initTrace = initLaminar
export const initTracing = initLaminar
export const setupLaminar = initLaminar
export const setupTrace = initLaminar
export const setupTracing = initLaminar

export async function flushLaminar(): Promise<void> {
  if (!initialized) return
  try {
    const mod: any = await import("@lmnr-ai/lmnr")
    const Laminar = mod?.Laminar ?? mod?.default?.Laminar
    if (Laminar && typeof Laminar.flush === "function") await Laminar.flush()
  } catch {
    /* ignore */
  }
}
export const flushTrace = flushLaminar
export const flushTraces = flushLaminar
export const flushTracing = flushLaminar

export async function withSpan<T>(
  name: string,
  attrs: TraceAttrs = {},
  fn: () => T | Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  if (!laminarEnabled(env)) return await fn()
  const ok = await initLaminar(env)
  if (!ok) return await fn()
  try {
    const mod: any = await import("@lmnr-ai/lmnr")
    const Laminar = mod?.Laminar ?? mod?.default?.Laminar
    if (!Laminar) return await fn()
    const span = typeof Laminar.startSpan === "function"
      ? Laminar.startSpan({ name, metadata: attrs, spanType: "DEFAULT" })
      : null
    if (!span) return await fn()
    try {
      if (typeof Laminar.setSpanAttributes === "function") Laminar.setSpanAttributes(attrs as any)
    } catch {
      /* ignore attribute errors */
    }
    // fn runs EXACTLY once below: its errors propagate (never re-run);
    // post-fn tracing errors are swallowed (fn already succeeded).
    let result: T
    try {
      result = await Laminar.withSpan(span, async () => await fn(), true)
    } catch (e) {
      try {
        if (typeof span.recordException === "function") span.recordException(e as any)
      } catch {
        /* ignore */
      }
      throw e
    }
    try {
      if (typeof Laminar.setSpanOutput === "function") Laminar.setSpanOutput(result)
    } catch {
      /* output-recording failed after fn succeeded: keep result */
    }
    return result
  } catch {
    // Tracing infra failed before fn ran: naked run, exactly once.
    // (fn errors never reach here — they propagate from the inner try.)
    return await fn()
  }
}

// aliases
export const withTrace = withSpan
export const traceSpan = withSpan
export const span = withSpan
export const runInSpan = withSpan
export const trace = withSpan
export const observe = withSpan
export const withTracing = withSpan
export const traceFn = withSpan
export const traced = withSpan

export async function startSpan(name: string, attrs: TraceAttrs = {}, env: NodeJS.ProcessEnv = process.env): Promise<any> {
  if (!laminarEnabled(env)) return null
  const ok = await initLaminar(env)
  if (!ok) return null
  try {
    const mod: any = await import("@lmnr-ai/lmnr")
    const Laminar = mod?.Laminar ?? mod?.default?.Laminar
    if (!Laminar || typeof Laminar.startSpan !== "function") return null
    return Laminar.startSpan({ name, metadata: attrs, spanType: "DEFAULT" })
  } catch {
    return null
  }
}

export async function endSpan(span: any): Promise<void> {
  if (!span) return
  try { if (typeof span.end === "function") span.end() } catch { /* ignore */ }
}

export { startSpan as beginSpan, startSpan as startTrace, endSpan as finishSpan, endSpan as closeSpan, endSpan as endTrace }

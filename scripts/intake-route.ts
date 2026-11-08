/**
 * Intake routing (#9): pure function, no network.
 * Inputs: Jev scores (nullable when Jev skipped) + JS pre-check flags.
 * Output: decision + labels. Thresholds versioned here.
 */

export const THRESH = { repoReject: 0.5, clearLow: 1.0, sizeSplit: 1.5, dupAuto: 0.9, dupHuman: 0.7, typeMin: 0.8 } as const;

export type Decision =
  | "rejected-out-of-scope"
  | "needs-info"
  | "duplicate-close"
  | "duplicate-review"
  | "needs-shared"
  | "needs-split"
  | "ready"

export interface RouteInput {
  repoFit: number | null // null = role missing -> needs-human upstream
  roleMissing: boolean
  emptyTemplate: boolean
  exactDupOf: number | null
  isClear: number | null
  size: number | null
  duplicate: number | null
  typeConfidence: number | null
}

export interface RouteResult {
  decision: Decision
  labels: string[]
  closeAs?: "duplicate" | "wontfix" | "invalid"
  linkTo?: number
}

export function routeIntake(r: RouteInput): RouteResult {
  if (r.roleMissing) return { decision: "needs-info", labels: ["needs-human", "needs-role"] }
  if (r.emptyTemplate) return { decision: "needs-info", labels: ["needs-info"] }
  if (r.exactDupOf != null)
    return { decision: "duplicate-close", labels: ["duplicate"], closeAs: "duplicate", linkTo: r.exactDupOf }
  if (r.repoFit != null && r.repoFit < THRESH.repoReject)
    return { decision: "rejected-out-of-scope", labels: ["rejected-out-of-scope"] }
  if (r.isClear != null && r.isClear < THRESH.clearLow)
    return { decision: "needs-info", labels: ["needs-info"] }
  if (r.duplicate != null && r.duplicate >= THRESH.dupAuto)
    return { decision: "duplicate-close", labels: ["duplicate"], closeAs: "duplicate" }
  if (r.duplicate != null && r.duplicate >= THRESH.dupHuman)
    return { decision: "duplicate-review", labels: ["needs-human", "possible-duplicate"] }
  if (r.size != null && r.size >= THRESH.sizeSplit)
    return { decision: "needs-split", labels: ["needs-split"] }
  return { decision: "ready", labels: ["ready"] }
}

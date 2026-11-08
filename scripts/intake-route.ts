/**
 * Intake routing (#9): pure function, no network.
 * Inputs: Jev scores (nullable when Jev skipped) + JS pre-check flags.
 * Output: decision + labels. Thresholds versioned here.
 */

// All score thresholds are 0-1 NORMALIZED (raw score / top level number).
// Calibrated 2026-11-08 on issues #1,2,3,5,7,8,13 (jev-1.13-free), recheck after any model/criteria change.
export const THRESH = {
  repoReject: 0.5, // repo_fit (noul) below -> out of scope
  repoReview: 0.9, // repo_fit in [0.5, 0.9) -> human
  clearLow: 0.5, // is_clear below -> needs-info
  sizeSplit: 0.5, // size at/above -> needs-split
  dupAuto: 0.9, // max same_as noul -> duplicate-close
  dupHuman: 0.7, // max same_as noul -> duplicate-review (+duplicateOf ids)
  typeMin: 0.8, // choice confidence below -> don't auto-label type
  confMin: 0.35, // any key score confidence below -> human review
} as const;

export type Decision =
  | "rejected-out-of-scope"
  | "needs-review"
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
  duplicateTop: number | null
  typeConfidence: number | null
  lowConfidence: boolean
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
  if (r.repoFit != null && r.repoFit < THRESH.repoReview)
    return { decision: "needs-review", labels: ["needs-human", "repo-review"] }
  if (r.lowConfidence)
    return { decision: "needs-review", labels: ["needs-human", "low-confidence"] }
  if (r.isClear != null && r.isClear < THRESH.clearLow)
    return { decision: "needs-info", labels: ["needs-info"] }
  if (r.duplicate != null && r.duplicate >= THRESH.dupAuto)
    return { decision: "duplicate-close", labels: ["duplicate"], closeAs: "duplicate", linkTo: r.duplicateTop ?? undefined }
  if (r.duplicate != null && r.duplicate >= THRESH.dupHuman)
    return { decision: "needs-review", labels: ["needs-human", "possible-duplicate"] }
  if (r.size != null && r.size >= THRESH.sizeSplit)
    return { decision: "needs-split", labels: ["needs-split"] }
  return { decision: "ready", labels: ["ready"] }
}

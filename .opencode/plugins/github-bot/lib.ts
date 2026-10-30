/**
 * Testable helpers extracted from the github-bot plugin.
 */

export function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function fenceUntrusted(content: string, nonce: string): string {
  return (
    `===== BEGIN UNTRUSTED PR CONTENT ${nonce} =====\n` +
    `${content}\n` +
    `===== END UNTRUSTED PR CONTENT ${nonce} =====`
  )
}

export function validateIssueNumber(issueNumber: unknown): { valid: boolean; error?: string } {
  if (!issueNumber || typeof issueNumber !== "number" || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    return { valid: false, error: "Error: invalid issue number" }
  }
  return { valid: true }
}

export function validateBranchName(branch: string): { valid: boolean; error?: string } {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch) || branch === "main" || branch === "master") {
    return { valid: false, error: `Error: invalid or protected branch name: ${branch}` }
  }
  return { valid: true }
}

export function isProtectedBranch(branch: string): boolean {
  return branch === "main" || branch === "master"
}
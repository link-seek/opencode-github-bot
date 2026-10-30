import { Plugin } from "@opencode/plugin"
import { fenceUntrusted, randomNonce, validateIssueNumber, validateBranchName } from "./lib"

/**
 * OpenCode v2 GitHub Bot — self-contained server plugin.
 *
 * Model only edits code. All git/PR/GitHub operations are hardcoded in tools.
 * Tools: gh-pr-comment, gh-pr-review, finish-review, finish-fix
 * Hook: nonce fence on prompt
 */


async function runShell(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  // Use Bun.$ if available (opencode runs on Bun), fallback to child_process
  try {
    const proc = Bun.spawn(["bash", "-c", cmd], {
      cwd: cwd || process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    return { stdout: stdout.trim(), stderr: stderr.trim(), code }
  } catch {
    // Fallback to child_process
    const { execSync } = await import("node:child_process")
    try {
      const stdout = execSync(cmd, { cwd: cwd || process.cwd(), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      return { stdout: stdout.trim(), stderr: "", code: 0 }
    } catch (e: any) {
      return { stdout: "", stderr: e.stderr?.toString() ?? e.message, code: e.status ?? 1 }
    }
  }
}

async function ghApi(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const token = process.env.GITHUB_TOKEN
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${method} ${path}: ${res.status} ${text}`)
  }
  return res.json()
}

export default Plugin.define({
  id: "github-bot",

  async setup(ctx) {
    const repo = process.env.GITHUB_REPOSITORY ?? ""

    // --- GitHub write tools -------------------------------------------------
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "gh", description: "GitHub operations" })

      editor.add({
        name: "gh-pr-comment",
        description: "Post a comment on a PR or issue",
        input: {
          type: "object",
          properties: {
            number: { type: "integer", description: "PR or issue number" },
            body: { type: "string", description: "Comment body (markdown)" },
          },
          required: ["number", "body"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { number, body } = input as { number: number; body: string }
          try {
            const data = await ghApi("POST", `/repos/${repo}/issues/${number}/comments`, { body })
            return { content: `Comment posted: ${data.html_url ?? "ok"}` }
          } catch (e: any) {
            return { content: `Failed: ${e.message}` }
          }
        },
      })

      editor.add({
        name: "gh-pr-review",
        description: "Submit a PR review (COMMENT/APPROVE/REQUEST_CHANGES)",
        input: {
          type: "object",
          properties: {
            number: { type: "integer", description: "PR number" },
            body: { type: "string", description: "Review body" },
            event: { type: "string", enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"] },
          },
          required: ["number", "body", "event"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { number, body, event } = input as { number: number; body: string; event: string }
          try {
            const data = await ghApi("POST", `/repos/${repo}/pulls/${number}/reviews`, { body, event })
            return { content: `Review submitted: ${data.html_url ?? data.id ?? "ok"}` }
          } catch (e: any) {
            return { content: `Failed: ${e.message}` }
          }
        },
      })

      editor.add({
        name: "finish-review",
        description: "Finalize a PR review. Call this after you have analyzed the PR and are ready to post your review. Pass your review body and optional inline comments.",
        input: {
          type: "object",
          properties: {
            prNumber: { type: "integer", description: "PR number" },
            body: { type: "string", description: "Top-level review body" },
            inlineComments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  line: { type: "integer" },
                  body: { type: "string" },
                },
                required: ["path", "line", "body"],
              },
              description: "Optional inline comments",
            },
          },
          required: ["prNumber", "body"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { prNumber, body, inlineComments } = input as {
            prNumber: number
            body: string
            inlineComments?: Array<{ path: string; line: number; body: string }>
          }
          const results: string[] = []

          // Post inline comments
          if (inlineComments && inlineComments.length > 0) {
            for (const c of inlineComments) {
              try {
                await ghApi("POST", `/repos/${repo}/pulls/${prNumber}/comments`, {
                  body: c.body,
                  path: c.path,
                  line: c.line,
                  commit_id: (await ghApi("GET", `/repos/${repo}/pulls/${prNumber}`)).head.sha,
                })
                results.push(`inline: ${c.path}:${c.line}`)
              } catch (e: any) {
                results.push(`inline failed: ${c.path}:${c.line} — ${e.message}`)
              }
            }
          }

          // Post top-level review
          try {
            const data = await ghApi("POST", `/repos/${repo}/pulls/${prNumber}/reviews`, {
              body,
              event: "COMMENT",
            })
            results.push(`review: ${data.html_url ?? data.id ?? "ok"}`)
          } catch (e: any) {
            results.push(`review failed: ${e.message}`)
          }

          return { content: results.join("\n") }
        },
      })

      editor.add({
        name: "finish-fix",
        description: "Finalize an issue fix. Call this after you have implemented and tested the fix. This tool handles all git operations (commit, push, branch management, PR creation) internally.",
        input: {
          type: "object",
          properties: {
            issueNumber: { type: "integer", description: "Issue number being fixed" },
            summary: { type: "string", description: "Brief summary of what was changed and why" },
          },
          required: ["issueNumber"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { issueNumber, summary } = input as { issueNumber: number; summary?: string }
          const results: string[] = []

          // Safety: validate issue number
          const issueCheck = validateIssueNumber(issueNumber)
          if (!issueCheck.valid) {
            return { content: issueCheck.error! }
          }

          // Safety: never operate on protected branches
          const currentBranch = (await runShell("git branch --show-current")).stdout
          if (currentBranch === "main" || currentBranch === "master") {
            return { content: "Error: cannot commit on protected branch (main/master). Checkout a feature branch first." }
          }

          // 1. Check for changes
          const diff = await runShell("git diff --stat && git diff --cached --stat")
          const status = await runShell("git status --porcelain")
          if (!status.stdout) {
            return { content: "No changes detected. Nothing to commit." }
          }
          results.push(`Changes detected:\n${diff.stdout || status.stdout}`)

          // 1.5. Setup git identity and auth
          const token = process.env.GITHUB_TOKEN
          const repo = process.env.GITHUB_REPOSITORY
          await runShell('git config --global user.name "jennifer95929-svgs"')
          await runShell('git config --global user.email "272089793+jennifer95929-svgs@users.noreply.github.com"')
          if (token && repo) {
            await runShell(`git remote set-url origin https://x-access-token:${token}@github.com/${repo}.git`)
          }

          // 2. Commit
          const commitMsg = `fix: resolve issue #${issueNumber}`
          const commit = await runShell(`git add -A && git commit -m "${commitMsg}"`)
          if (commit.code !== 0) {
            return { content: `Commit failed: ${commit.stderr}` }
          }
          results.push("Committed.")

          // 3. Check for existing open PRs
          let existingPR: { number: number; head: string } | null = null
          try {
            const prs = await ghApi("GET", `/repos/${repo}/pulls?state=open`)
            for (const pr of prs) {
              if (pr.body && pr.body.includes(`Closes #${issueNumber}`)) {
                existingPR = { number: pr.number, head: pr.head.ref }
                break
              }
            }
          } catch { /* non-fatal */ }

          const branch = existingPR ? existingPR.head : `fix/issue-${issueNumber}`

          // Safety: validate branch name
          const branchCheck = validateBranchName(branch)
          if (!branchCheck.valid) {
            return { content: branchCheck.error! }
          }

          // 4. Push
          if (existingPR) {
            await runShell(`git fetch origin ${branch}`)
            await runShell(`git checkout ${branch}`)
            await runShell(`git cherry-pick HEAD 2>/dev/null || true`) // noop if already on branch
          } else {
            await runShell(`git checkout -b ${branch}`)
          }
          const push = await runShell(`git push --force-with-lease origin ${branch}`)
          if (push.code !== 0) {
            // Fallback to force push if lease fails (new branch)
            const push2 = await runShell(`git push -u origin ${branch}`)
            if (push2.code !== 0) {
              return { content: `Push failed: ${push.stderr}\n${push2.stderr}` }
            }
          }
          results.push(`Pushed to ${branch}.`)

          // 5. Create or update PR
          if (existingPR) {
            try {
              await ghApi("POST", `/repos/${repo}/issues/${existingPR.number}/comments`, {
                body: `Updated with new fix attempt.\n\n${summary ?? ""}`,
              })
              results.push(`Updated existing PR #${existingPR.number}`)
            } catch (e: any) {
              results.push(`PR comment failed: ${e.message}`)
            }
          } else {
            try {
              const prData = await ghApi("POST", `/repos/${repo}/pulls`, {
                title: `fix: resolve issue #${issueNumber}`,
                body: `Closes #${issueNumber}\n\n${summary ?? ""}`,
                head: branch,
                base: "main",
                draft: true,
              })
              results.push(`Created PR #${prData.number}: ${prData.html_url}`)
            } catch (e: any) {
              results.push(`PR creation failed: ${e.message}`)
            }
          }

          return { content: results.join("\n") }
        },
      })
    })

    // --- Prompt hook: fence untrusted content -------------------------------
    await ctx.session.hook("prompt", (event) => {
      const nonce = randomNonce()
      if (event.prompt.text) {
        event.prompt.text = fenceUntrusted(event.prompt.text, nonce)
      }
    })

    await ctx.storage.set("loaded", true)
    console.log(`github-bot plugin loaded in OpenCode ${ctx.app.version}`)
  },
})
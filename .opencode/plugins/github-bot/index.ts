import { Plugin } from "@opencode/plugin"

/**
 * OpenCode v2 GitHub Bot — server plugin.
 *
 * Registers GitHub write tools (comment, review, PR create) and a prompt hook
 * that fences untrusted PR/issue content with a random nonce, mirroring the
 * security boundary from OpenHands pr-review.
 */

function fenceUntrusted(content: string, nonce: string): string {
  return (
    `===== BEGIN UNTRUSTED PR CONTENT ${nonce} =====\n` +
    `${content}\n` +
    `===== END UNTRUSTED PR CONTENT ${nonce} =====`
  )
}

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export default Plugin.define({
  id: "github-bot",

  async setup(ctx) {
    // --- GitHub write tools -------------------------------------------------
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "gh", description: "GitHub write operations" })

      editor.add({
        name: "gh-pr-comment",
        description: "Post a comment on a pull request or issue",
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
          const repo = process.env.GITHUB_REPOSITORY
          const token = process.env.GITHUB_TOKEN
          const res = await fetch(
            `https://api.github.com/repos/${repo}/issues/${number}/comments`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              body: JSON.stringify({ body }),
              signal: context.signal,
            },
          )
          if (!res.ok) {
            const text = await res.text()
            return { content: `Failed: ${res.status} ${text}` }
          }
          const data = (await res.json()) as { html_url?: string }
          return { content: `Comment posted: ${data.html_url ?? "ok"}` }
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
            event: {
              type: "string",
              enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
              description: "Review event type",
            },
          },
          required: ["number", "body", "event"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { number, body, event } = input as {
            number: number
            body: string
            event: string
          }
          const repo = process.env.GITHUB_REPOSITORY
          const token = process.env.GITHUB_TOKEN
          const res = await fetch(
            `https://api.github.com/repos/${repo}/pulls/${number}/reviews`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              body: JSON.stringify({ body, event }),
              signal: context.signal,
            },
          )
          if (!res.ok) {
            const text = await res.text()
            return { content: `Failed: ${res.status} ${text}` }
          }
          const data = (await res.json()) as { id?: number; html_url?: string }
          return { content: `Review submitted: ${data.html_url ?? data.id ?? "ok"}` }
        },
      })

      editor.add({
        name: "gh-pr-create",
        description: "Create a pull request",
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            head: { type: "string", description: "Head branch" },
            base: { type: "string", description: "Base branch" },
            draft: { type: "boolean", default: true },
          },
          required: ["title", "head", "base"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { title, body, head, base, draft } = input as {
            title: string
            body?: string
            head: string
            base: string
            draft?: boolean
          }
          const repo = process.env.GITHUB_REPOSITORY
          const token = process.env.GITHUB_TOKEN
          const res = await fetch(
            `https://api.github.com/repos/${repo}/pulls`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              body: JSON.stringify({ title, body: body ?? "", head, base, draft: draft ?? true }),
              signal: context.signal,
            },
          )
          if (!res.ok) {
            const text = await res.text()
            return { content: `Failed: ${res.status} ${text}` }
          }
          const data = (await res.json()) as { number?: number; html_url?: string }
          return { content: `PR created: #${data.number} ${data.html_url ?? ""}` }
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

    // --- Storage: remember last run ----------------------------------------
    await ctx.storage.set("loaded", true)
    const version = ctx.app.version
    console.log(`github-bot plugin loaded in OpenCode ${version}`)
  },
})
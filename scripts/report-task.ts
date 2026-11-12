/**
 * Emit one agent.task span for a finished agent run (#79).
 *
 * Runs in the composite step AFTER `opencode run` exits (which may not flush),
 * so the task record lands even when the agent process dies abruptly.
 * No key / no SDK => silent no-op. Never fails the step.
 *
 * Env: MODE, REPOSITORY, PR_NUMBER, ISSUE_NUMBER, MODEL/OPENCODE_MODEL/CLI_MODEL,
 *   TASK_STARTED_AT (epoch seconds), TASK_EXIT_CODE.
 */
import { flushSoon, withSpan } from "./trace"

function num(v: string | undefined): number | undefined {
  const n = Number(v ?? 0)
  return n ? n : undefined
}

export async function reportTask(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const startedAt = Number(env.TASK_STARTED_AT ?? 0) || Math.floor(Date.now() / 1000)
  const endedAt = Math.floor(Date.now() / 1000)
  const exitCode = Number(env.TASK_EXIT_CODE ?? 0)
  const issueNumber = num(env.ISSUE_NUMBER)
  const prNumber = num(env.PR_NUMBER)
  const model = env.MODEL || env.OPENCODE_MODEL || env.CLI_MODEL || ""

  await withSpan(
    "agent.task",
    {
      mode: env.MODE || "review",
      repository: env.REPOSITORY || "",
      ...(issueNumber != null ? { "issue.number": issueNumber } : {}),
      ...(prNumber != null ? { "pr.number": prNumber } : {}),
      ...(model ? { "model.id": model } : {}),
      "task.duration_s": Math.max(0, endedAt - startedAt),
      "task.exit_code": exitCode,
      "task.success": exitCode === 0,
    },
    async () => {},
    env as NodeJS.ProcessEnv,
  ).catch(() => {})
  await flushSoon()
}

if (import.meta.main) {
  await reportTask()
}

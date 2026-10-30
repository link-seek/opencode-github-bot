---
name: issue-fix
description: Fix a GitHub issue (model only edits code; plugin handles git/PR and tests)
---

You are an automated fixer. Given an issue, implement the fix.

## Steps

1. Read the issue title and body from `.opencode/issue-context.md`.
2. Explore the repository to understand the codebase and locate relevant files.
3. Implement the fix with minimal changes.
4. Call the `finish-fix` tool with the issue number and a brief summary of your changes.

The `finish-fix` tool will automatically detect and run tests if possible. If tests fail, it will return the failure details and you should fix the code and call `finish-fix` again.

## Constraints

- Do not modify unrelated files.
- Do not run git commands (commit, push, branch). The `finish-fix` tool handles all git/PR operations.
- Do not run tests manually. The `finish-fix` tool will detect and run tests automatically.
- If the fix requires more than 3 files, summarize the plan before editing.
- If you cannot determine a safe fix, call `finish-fix` with a summary explaining why, or post a comment via `gh-pr-comment`.
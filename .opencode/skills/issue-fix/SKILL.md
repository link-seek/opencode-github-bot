---
name: issue-fix
description: Fix a GitHub issue (model only edits code; plugin handles git/PR)
---

You are an automated fixer. Given an issue, implement the fix.

## Tools available

You have native tools: read, bash, edit, glob, grep. Use them directly.
Do NOT use the execute (Code Mode) tool. Do NOT call tools.opencode.models or any Code Mode function.

## Steps

1. Read the issue title and body from .opencode/issue-context.md.
2. Explore the repository to understand the codebase and locate relevant files.
3. Implement the fix with minimal changes.
4. Run existing tests if applicable; do not introduce new test failures.
5. Call the finish-fix tool with the issue number and a brief summary of your changes.

## Constraints

- Do not modify unrelated files.
- Do not run git commands (commit, push, branch). The finish-fix tool handles all git/PR operations.
- If the fix requires more than 3 files, summarize the plan before editing.
- If tests fail after your change, fix them or revert; do not leave broken tests.
- If you cannot determine a safe fix, call finish-fix with a summary explaining why, or post a comment via gh-pr-comment.

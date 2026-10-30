---
name: issue-fix
description: Fix a GitHub issue and open a PR
---

You are an automated fixer. Given an issue, implement the fix and open a PR.

## Steps

1. Read the issue title and body (provided in context).
2. Explore the repository to understand the codebase and locate relevant files.
3. Implement the fix with minimal changes.
4. Run existing tests if applicable; do not introduce new test failures.
5. Commit with a conventional commit message.
6. Use `gh-pr-create` to open a draft PR against the default branch, referencing the issue number.

## Constraints

- Do not modify unrelated files.
- Do not push to the default branch directly.
- If the fix requires more than 3 files, summarize the plan before editing.
- If tests fail after your change, fix them or revert; do not leave broken tests.
- If you cannot determine a safe fix, post a comment via `gh-pr-comment` explaining why and stop.
---
name: issue-fix
description: Fix a GitHub issue and open a PR
---

You are an automated fixer. Given an issue, implement the fix and open a PR.

## Steps

1. Read the issue title and body from `.opencode/issue-context.md`.
2. Check the "Existing Open PRs for This Issue" section. If open PRs exist:
   - Reuse the existing branch: `git fetch origin <branch> && git checkout <branch>`.
   - Apply your changes on top, commit, and `git push --force-with-lease origin <branch>`.
   - Do NOT create a new PR. Post a comment on the existing PR noting the update.
   - If the new fix supersedes the old one entirely, close the old PR with a comment.
3. If no open PR exists:
   a. Explore the repository to understand the codebase and locate relevant files.
   b. Implement the fix with minimal changes.
   c. Run existing tests if applicable; do not introduce new test failures.
   d. Create a new branch: `git checkout -b fix/issue-${ISSUE_NUMBER}`.
   e. Stage and commit: `git add -A && git commit -m "fix: resolve issue #${ISSUE_NUMBER}"`.
   f. Push: `git push origin fix/issue-${ISSUE_NUMBER}`.
   g. Use `gh-pr-create` tool to open a draft PR against the default branch, referencing the issue number (include "Closes #${ISSUE_NUMBER}" in body).

## Constraints

- Do not modify unrelated files.
- Do not push to the default branch directly.
- If the fix requires more than 3 files, summarize the plan before editing.
- If tests fail after your change, fix them or revert; do not leave broken tests.
- If you cannot determine a safe fix, post a comment via `gh-pr-comment` explaining why and stop.
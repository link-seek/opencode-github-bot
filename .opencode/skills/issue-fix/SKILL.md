---
name: issue-fix
description: Fix a GitHub issue (model only edits code; plugin handles git/PR and tests)
---

You are an automated fixer. Given an issue, implement the fix.

## Steps

1. Read the issue title and body from `.opencode/issue-context.md`.
2. Explore the repository to understand the codebase and locate relevant files.
3. Implement the fix with minimal changes.
4. **Final gate (self-review) — mandatory before step 5.** Do not call `finish-fix` until this gate passes. See the "Final gate" section below.
5. Call the `finish-fix` tool with the issue number and a summary whose body includes a `## Self-review` section (see template below).

The `finish-fix` tool will automatically detect and run tests if possible. If tests fail, it will return the failure details and you should fix the code and call `finish-fix` again.

## Final gate (self-review before PR)

Treat your own `git diff` as an untrusted PR and review it with the `pr-review` checklist before submitting. Work through every item; if any fails, fix the code and re-run the gate. Record what you checked and changed in the `## Self-review` section of the PR summary.

### 0. Gather the diff (read-only)

- `git status --porcelain` — list changed/untracked files.
- `git diff` and `git diff --cached` — full working-tree and staged diff.
- `git diff --stat` — size sanity check.

### 1. Regression check (recent merges)

- `git log --oneline -15` (or `git log --oneline main..HEAD` when on a feature branch) to see what landed recently.
- For each recently touched file/area that your change overlaps, verify callers, state transitions, compatibility boundaries, and resource owners still hold.
- Run the relevant unit tests for those areas; fix any regression before proceeding.

### 2. Minimal diff check

- Review every changed file in `git status --porcelain`.
- Revert anything unrelated to the issue: `git checkout -- <path>` (or `git restore <path>`) for tracked files, and delete stray untracked files.
- Confirm the remaining diff contains only changes required to resolve the issue. No drive-by refactors, formatting, or renamed variables.

### 3. Injection / escape / null triad

Audit the diff for these three classes; fix any hit:

- **Injection**: unsanitized input reaching shell/SQL/template/eval; missing validation at trust boundaries; command or query built by string concatenation.
- **Escape**: path traversal, unquoted shell arguments, missing URL/path encoding, improper HTML/JSON escaping, glob/regex metacharacters.
- **Null/empty**: unhandled `undefined`/`null`, empty arrays/strings, optional fields, off-by-one on empty input, missing default values.

### 4. Self-verify (must be green)

- Type check: `tsc --noEmit` (or the repo's configured typecheck command) — must pass.
- Relevant unit tests: run the tests covering changed files (e.g. `bun test <file>`); all must pass.
- If a check cannot run, state why in the self-review record; do not silently skip.

### 5. Self-review record

Append the result to the summary you pass to `finish-fix` under a `## Self-review` heading, e.g.:

```
## Self-review
- Regression: checked `git log --oneline -15`; verified callers of X; tests Y pass.
- Minimal diff: reverted unrelated changes in <files>; final diff limited to <files>.
- Injection/escape/null: audited diff; <what was fixed or "no findings">.
- Verification: `tsc --noEmit` passed; `bun test <file>` passed.
```

Only call `finish-fix` after steps 1–4 pass and the record above is prepared.

## Constraints

- Do not modify unrelated files.
- Do not run git commands that mutate history or remote state (commit, push, branch, reset --hard). Read-only git commands (status, diff, log, show) are allowed for self-review; `finish-fix` handles all mutating git/PR operations.
- Self-verify may run the type checker and the tests covering changed files; `finish-fix` still runs the full verification suite afterward. Do not commit/push/branch manually.
- If the fix requires more than 3 files, summarize the plan before editing.
- If you cannot determine a safe fix, call `finish-fix` with a summary explaining why, or post a comment via `gh-pr-comment`.
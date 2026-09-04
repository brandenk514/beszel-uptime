---
name: finishing-git-worktree
description: "Use when finishing work in a git worktree created by the using-git-worktrees skill - commits changes, merges or opens a PR, and cleans up the worktree."
---

# Finishing a Git Worktree

## Overview

Hand off completed work from a git worktree: verify tests still pass, commit, create a branch/PR, and clean up. **Never push to `main`** — only merge into long-lived branches or open a PR.

**Announce at start:** "I'm using the finishing-git-worktree skill to hand off this work."

## Step 1: Verify State

```bash
git status
git branch --show-current
git worktree list
```

- If there are uncommitted changes, review them with the user before committing.
- If on `main` or another protected branch directly, stop and ask — work in a worktree should be on its own branch.

## Step 2: Run Tests One Last Time

For beszel-uptime:

```bash
make test          # go test -tags='testing no_ui' ./...
```

If tests fail, report them and ask whether to fix, skip, or proceed. Do not clean up the worktree if the user wants to keep iterating.

## Step 3: Commit

```bash
git add -A
git commit -m "<imperative-summary>"
```

- Conventional-commit style preferred (`feat:`, `fix:`, `chore:`).
- If the user asks for a PR, push to a new remote branch:
  ```bash
  git push -u origin HEAD
  ```

## Step 4: Merge or PR

**Decision:**
- **Small, isolated fix** and user wants it merged: merge to the target branch (default: `main`) with `git merge --no-ff <worktree-branch>` from the main checkout, then delete the branch.
- **Feature or larger change**: open a PR with the `create-pull-request` skill from the GitHub PR extension. Include a summary of changes, test results, and any follow-ups.
- **Never force-push `main`** or any shared branch.

## Step 5: Clean Up

After merge/PR is accepted (or the user explicitly says to clean up):

```bash
cd <main-checkout>
git worktree remove <worktree-path>
git branch -d <worktree-branch>
```

If `git worktree remove` complains about untracked files, confirm with the user before using `--force`.

### Report

```
Work finished:
- Branch: <branch>
- PR/merge: <url or "merged to main">
- Worktree: removed / kept at <path>
```

## Guardrails

- **No upstream contributions** unless the user explicitly asks — do not open PRs to `henrygd/beszel` or other upstream repos from this workspace.
- **Confirm before destructive ops** (`worktree remove --force`, `branch -D`, force-push).
- **Preserve work** — if anything is ambiguous, ask instead of deleting.

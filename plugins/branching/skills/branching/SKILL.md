---
name: branching
description: Lock the repo to a hardgated branch+PR workflow — ensure stable & main branches exist, set stable as default, restrict CI/CD to main, and write the policy into CLAUDE.md
user-invocable: true
argument-hint: "[--reapply]"
---

Enforce a hardgated branch-and-PR workflow on this repo. After this skill runs, every change to the repo must go through a feature branch and a PR into `stable`. Direct commits, pushes, and force-pushes to `stable` and `main` are banned by `CLAUDE.md`. CI/CD on `main` only.

**Constants (hardcoded):**
- **Default integration branch:** `stable`
- **Release / CI-CD branch:** `main`
- **Source for new branches** (when missing): the repo's current default branch HEAD (or `master` if the default is itself missing)
- **CLAUDE.md location:** `<repo_root>/CLAUDE.md`
- **Workflow scan path:** `<repo_root>/.github/workflows/*.yml` and `*.yaml`
- **Policy block delimiters in CLAUDE.md** (for idempotent re-apply):
  - Start: `<!-- BEGIN: branching skill -->`
  - End: `<!-- END: branching skill -->`

**Procedure:**

1. **Pre-flight checks** — collect failures and report all together before stopping:
   - `git rev-parse --show-toplevel` — must succeed. Record as `<repo_root>` and `cd` to it. Otherwise STOP: `"Not a git repo."`
   - `gh auth status` — must succeed. Otherwise STOP: `"Run gh auth login first."`
   - `gh repo view --json nameWithOwner,defaultBranchRef,url` — capture `<gh_repo_slug>`, `<current_default_branch>`, `<gh_repo_url>`. If this fails, the repo has no GitHub remote — STOP: `"This skill requires a GitHub remote. Push the repo to GitHub first."`
   - `git fetch origin --prune` — must succeed.

2. **Detect current branch state:**
   - `git ls-remote --heads origin stable main master`
   - Record `<has_stable>`, `<has_main>`, `<has_master>` (booleans for remote presence).
   - Determine `<source_branch>` for any branches we need to create:
     - If `<current_default_branch>` exists → use it.
     - Else if `<has_master>` → use `master`.
     - Else STOP: `"Cannot determine a source branch to create stable/main from."`

3. **Detect CI/CD workflows:**
   - List files matching `<repo_root>/.github/workflows/*.yml` and `*.yaml`.
   - For each, parse YAML and inspect `on.push.branches` and `on.pull_request.branches`.
   - Build `<workflow_changes>`: for each workflow whose push triggers include anything other than exactly `[main]`, plan to rewrite to `branches: [main]`. Workflows with no `on.push` trigger are left alone.

4. **Plan summary + confirmation** — print a compact, single-screen summary of every change about to be made:
   - **Branches:**
     - `stable`: exists / will be created from `<source_branch>`
     - `main`: exists / will be created from `<source_branch>`
   - **Default branch:** `<current_default_branch>` → `stable` (or "already stable, no change")
   - **Workflows to rewrite:** list each file with old `branches:` → new `branches: [main]`, or "none"
   - **CLAUDE.md:** create / append policy block / replace existing policy block (idempotent on re-apply)
   - Use AskUserQuestion: `"Apply these changes?"` → **Apply** / **Cancel**.
   - **Cancel** → STOP, zero changes.
   - If `--reapply` was passed, skip the dialog only when nothing destructive is planned (workflow rewrites and default-branch changes always require confirmation).

5. **Apply: create missing branches:**
   - If `stable` is missing on remote:
     ```bash
     git fetch origin <source_branch>
     git branch stable origin/<source_branch>
     git push -u origin stable
     ```
   - If `main` is missing on remote:
     ```bash
     git fetch origin <source_branch>
     git branch main origin/<source_branch>
     git push -u origin main
     ```
   - If a branch exists locally but not remotely, push it (`git push -u origin <branch>`).
   - Never delete or rewrite an existing `stable` or `main`.

6. **Apply: set `stable` as the GitHub default branch:**
   - `gh repo edit --default-branch stable`
   - Verify: `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` must return `stable`.
   - On failure (usually missing admin perms), STOP and tell the user exactly: `"Could not change default branch — your gh token lacks admin:repo permissions. Either grant them (gh auth refresh -s admin:repo) or set the default branch to 'stable' manually in GitHub Settings."`

7. **Apply: restrict CI/CD to `main`:**
   - For each workflow in `<workflow_changes>`:
     - Read the file.
     - Rewrite `on.push.branches` to exactly `[main]`. Preserve all other keys (jobs, env, schedule, workflow_dispatch, pull_request, etc.) byte-identically. Use a YAML-aware edit, not a regex blanket replace — but if the workflow uses block-style `branches:` lists with simple scalars (the common case), a targeted multi-line edit is fine.
     - If `on.pull_request.branches` exists and references `stable`, leave it alone. PR-target branches are coordination signals, not deploy triggers.
   - If no workflows exist, skip this step silently.

8. **Apply: write the HARDGATED policy into `CLAUDE.md`:**
   - If `<repo_root>/CLAUDE.md` does not exist, create it with just the policy block below (no other content).
   - If it exists and already contains the delimited block (`<!-- BEGIN: branching skill -->` … `<!-- END: branching skill -->`), replace it in place.
   - Otherwise, append the policy block at the end of the file with one blank line of separation.
   - The block to write is **exactly**:

     ```markdown
     <!-- BEGIN: branching skill -->
     # Branching policy — HARDGATED

     **Every change to this repo goes through a feature branch and a PR. No exceptions.**

     - `stable` is the default branch. All PRs target `stable`.
     - `main` is the release / CI-CD branch. Humans only.
     - **NEVER** commit, push, or force-push to `stable` or `main`.
     - **NEVER** merge `stable` → `main` from a Claude session — humans promote releases.
     - **NEVER** edit files while checked out on `stable` or `main`. Switch to a feature branch first.

     **Workflow for every task:**
     1. `git fetch origin && git checkout stable && git pull --ff-only`
     2. Create a branch: `<handle>/<short-slug>` — `<handle>` = local part of `git config user.email`.
     3. Open a **draft PR** targeting `stable` BEFORE writing code. The draft PR is your claim.
     4. Run `gh pr list --state open` first; if any open PR overlaps with your task, STOP and ask.
     5. Keep PRs small and atomic. Rebase onto `stable` before requesting review.
     6. Do NOT self-merge unless the user explicitly says so.

     On any rebase or merge conflict: STOP and ask the user. The other side may be another developer's in-flight work.
     <!-- END: branching skill -->
     ```

9. **Final summary** — display:
   - GitHub URL: `<gh_repo_url>`
   - Default branch: `stable` (was `<current_default_branch>`)
   - Branches present: `stable`, `main` (note which were newly created)
   - Workflows rewritten: list filenames, or "none"
   - CLAUDE.md: created / policy block added / policy block replaced
   - Reminder: `"Tell collaborators to run \`git fetch && git remote set-head origin -a\` so their local default tracker updates."`
   - Reminder (manual, not automated): `"For maximum hardgating, enable GitHub branch protection on stable and main: Settings → Branches → require PRs, block force-pushes, block direct commits. The skill does not enable this automatically because it requires admin scope and is irreversible without admin."`

**Rules:**
- **NEVER** delete or rewrite an existing `stable` or `main` branch.
- **NEVER** rename `main` ↔ `master`. If `master` exists, leave it alone.
- **NEVER** force-push from this skill.
- **NEVER** modify a workflow that has no `on.push` trigger.
- **NEVER** modify any part of a workflow other than `on.push.branches`.
- **NEVER** touch GitHub branch protection rules — only suggest them in the summary.
- **NEVER** modify any section of `CLAUDE.md` outside the delimited `<!-- BEGIN: branching skill --> … <!-- END: branching skill -->` block.
- **NEVER** commit or push the CLAUDE.md edit on the user's behalf — the user owns that commit (it must go through the same PR workflow it's establishing).
- **ALWAYS** show the full plan (Step 4) and get explicit confirmation before applying.
- **ALWAYS** make every step idempotent: re-running the skill on an already-configured repo must be a no-op or a clean re-apply.
- **ALWAYS** preserve YAML formatting and key ordering when editing workflow files.

$ARGUMENTS

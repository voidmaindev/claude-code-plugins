---
name: normalize
description: Normalize an existing project — replace CLAUDE.md with the canonical default, create the GitHub Projects Kanban board on the current repo, then strip init sections
user-invocable: true
---

Bring an existing project up to our standard layout: canonical CLAUDE.md, a fresh GitHub Projects Kanban board on the current repo, and all one-time init sections stripped — exactly as if it had been scaffolded with `new-project` and then cleaned with `post-init`.

This skill **does not redefine** how any of that work is done. It links to the other skills and to the canonical CLAUDE.md, so any future change to those sources flows through automatically.

**Procedure:**

1. **Detect the current project's GitHub repo:**
   - Run `gh repo view --json nameWithOwner` from the current working directory to confirm it is a GitHub-connected repo, and capture `<github_user>/<repo_name>`.
   - **If it is not** a GitHub-connected repo (no `origin`, or `origin` doesn't point at GitHub):
     - Offer to create one — do this **exactly as the `new-project` skill does in step 6** ("Create the GitHub repository"), using the current folder name as the repo name and `--private` by default. Then push the existing local contents.
     - If the user declines, STOP.
   - Store `<github_user>/<repo_name>` for the Kanban step.

2. **Back up and replace CLAUDE.md:**
   - If a `CLAUDE.md` already exists in the project root, rename it to `CLAUDE.md.bak` (overwriting any prior `.bak`).
   - **Fetch the default CLAUDE.md exactly as the `new-project` skill does in step 9** ("Fetch the default CLAUDE.md from GitHub") and write it to the project root as `CLAUDE.md`. Same source repo, same file, same fetch mechanism — no divergence.
   - If the fetch fails for any reason, restore `CLAUDE.md.bak` to `CLAUDE.md` and STOP.

3. **Create the GitHub Projects Kanban board on the current repo:**
   - Open the freshly written `CLAUDE.md` and follow its PM-board / Kanban setup instructions, targeting `<github_user>/<repo_name>` from step 1.
   - The fetched CLAUDE.md is the single source of truth for board structure, columns, initial issues, and any other setup detail — **do whatever it says, as it says it**. Do not invent or override anything here.
   - If a Projects board already exists on the repo, do not duplicate it — report and skip this step.

4. **Strip init sections from the new CLAUDE.md:**
   - **Invoke the `post-init` skill** against the project's CLAUDE.md. Let it run its normal find / identify / confirm / remove flow. Do not re-implement any of its logic here.

5. **Report summary:**
   - Whether a `CLAUDE.md.bak` was created.
   - Whether the Kanban board was created (with URL) or already existed.
   - Which init sections `post-init` removed (or "looks clean already").
   - The final `<github_user>/<repo_name>` the run targeted.

**Rules:**
- NEVER overwrite an existing `CLAUDE.md` without first creating `CLAUDE.md.bak`.
- NEVER copy procedural steps from `new-project`, `post-init`, or the default CLAUDE.md into this skill — always reference them so the sources stay in sync.
- If any step fails, report the error and STOP — do not continue with partial state.
- The order matters: Kanban creation must run **before** `post-init`, because `post-init` removes the very Kanban-setup instructions used in step 3.

$ARGUMENTS

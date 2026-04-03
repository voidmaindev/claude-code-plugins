---
name: post_init
description: Strip project initialization sections from CLAUDE.md after setup is complete
user-invocable: true
---

Clean up the active CLAUDE.md by removing all one-time project initialization sections that are no longer needed after the project is set up.

**Procedure:**

1. **Find the active CLAUDE.md:**
   - Look for `CLAUDE.md` in the current working directory.
   - If not found, walk up to the git root (`git rev-parse --show-toplevel`) and check there.
   - If still not found, tell the user: "No CLAUDE.md found in this project." and STOP.

2. **Read the CLAUDE.md** and identify ALL sections that are logically "project initialization" — anything that is a one-time setup action that has no value once the project is already running. This includes, but is NOT limited to:
   - **Kickoff interview** — sections about initial project questionnaire, interview groups, first-run Q&A
   - **Repo/folder creation** — GitHub repo creation, local folder scaffolding, git init steps
   - **Template initialization** — cloning from templates, go-template setup, module renaming
   - **PM board creation** — initial Kanban board setup, creating GitHub Projects, populating issues for the first time (NOT ongoing board maintenance/updates)
   - **Documentation folder creation** — creating the initial `docs/` folder and first docs (NOT updating existing docs)
   - **Hard sequencing rules** that only apply to the init flow (e.g., "no code until board is created")
   - **Anything else that logically fits the same pattern** — any section whose instructions only make sense during initial project setup and serve no purpose in an already-established project. Use judgment: if a section describes a one-time action that has already been completed, it's init content.

   **Keep everything that is ongoing:** code style rules, testing standards, tool preferences, per-session workflows (like daily board reviews), tech stack preferences, Docker rules, etc. If a section mixes init and ongoing content, extract and keep only the ongoing parts.

3. **Present findings to the user:**
   - List each identified init section by its heading and a one-line excerpt so the user can see what will be removed.
   - Ask: "These look like one-time project setup sections. Remove all of them from CLAUDE.md?"
   - Wait for the user's response. Do NOT proceed without explicit confirmation.

4. **If the user confirms:**
   - Remove all identified init sections from the CLAUDE.md.
   - Preserve all non-init content exactly as-is (formatting, ordering, whitespace).
   - Clean up any leftover empty lines or orphaned sub-sections from the removal.
   - Write the cleaned file.
   - Show a summary: list the headings that were removed and the approximate number of lines saved.

5. **If the user declines:**
   - Do nothing. Tell the user: "No changes made." and STOP.

**Rules:**
- NEVER remove a section without showing it to the user first and getting confirmation.
- NEVER modify content that is not project initialization related.
- If the CLAUDE.md has no init sections, tell the user: "No initialization sections found — CLAUDE.md looks clean already." and STOP.
- When in doubt about whether something is init-only, include it in the list shown to the user — let them decide.

$ARGUMENTS

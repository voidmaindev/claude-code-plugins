---
name: install-status-bar
description: Install the voidmaindev Claude Code status line at the user level (applies to every session)
user-invocable: true
---

Install the voidmaindev Claude Code status line into the **current user's** `~/.claude`
directory so it renders in **every** Claude Code session, across all projects. This copies
the bundled `statusline.js` into `~/.claude/statusline.js` and wires it up via the
`statusLine` key in `~/.claude/settings.json`, mirroring the maintainer's setup exactly.

The installer is safe and idempotent: it backs up any files it replaces (`*.bak`),
preserves every other key in `settings.json`, and refuses to run if `settings.json`
contains invalid JSON. Re-running it simply re-applies the same configuration.

**Procedure:**

1. **Preflight — require Node.js.** Run `node --version`. The status line is a Node.js
   script and is run by Node on every render, so Node must be installed. If `node` is not
   found, tell the user: "This status line requires Node.js, which isn't on your PATH.
   Install Node.js and re-run this skill." and STOP. Do not modify anything.

2. **Run the bundled installer.** Execute the installer that ships with this skill, using
   the `CLAUDE_SKILL_DIR` environment variable to locate it (it points to this skill's own
   directory):
   - bash / macOS / Linux: `node "$CLAUDE_SKILL_DIR/install.js"`
   - Windows PowerShell: `node "$env:CLAUDE_SKILL_DIR\install.js"`

   Pick the form that matches the current shell. The installer:
   - resolves the running user's home directory and ensures `~/.claude` exists,
   - copies the bundled `statusline.js` to `~/.claude/statusline.js` (backing up an
     existing, different copy to `statusline.js.bak`),
   - merges a `statusLine` block into `~/.claude/settings.json` with an **absolute** path
     to the copied script (the `statusLine.command` field does not expand `~` or env vars,
     so the absolute path is computed at install time), backing up the prior
     `settings.json` to `settings.json.bak`.

3. **Report the result.** Show the installer's output (the script path, the settings path,
   and the exact `command` written). Mention any `.bak` backups that were created. Tell the
   user the status line now applies to all future Claude Code sessions, and that the
   **current** session may need to be restarted before the bar appears.

4. **Explain what the bar shows** so the user knows what to expect. From left to right:
   - current **folder** name (bold cyan),
   - **git branch** (magenta), when inside a repo,
   - **model** name with any trailing `(… context)` suffix stripped (cyan),
   - **effort level** in brackets (yellow), when set,
   - **context-usage bar** labelled `ctx` — a 13-cell bar with the percentage centered
     inside, colored green / yellow / red as usage rises,
   - **5h** and **7d** subscription usage bars with time-to-reset (Pro/Max only; these
     appear after the first response in a session).

**Rules:**
- NEVER edit `~/.claude/settings.json` by hand here — always go through `install.js`, which
  does a safe merge and backup. If the installer aborts because `settings.json` is invalid
  JSON, surface that error to the user and STOP; do not attempt to repair or overwrite it.
- This skill targets the current user's `~/.claude` only. It does not touch project-level
  settings or other OS user accounts.

$ARGUMENTS

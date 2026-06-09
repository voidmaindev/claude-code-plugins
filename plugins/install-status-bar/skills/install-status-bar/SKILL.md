---
name: install-status-bar
description: Install the voidmaindev Claude Code status line at the user level (applies to every session)
user-invocable: true
---

Install the voidmaindev Claude Code status line into the **current user's** `~/.claude`
directory so it renders in **every** Claude Code session, across all projects. This copies
the bundled `statusline.js` into `~/.claude/statusline.js` and wires it up via the
`statusLine` key in `~/.claude/settings.json`, mirroring the maintainer's setup exactly.

The usage bars come in a **light** and a **dark** palette. The active theme cannot be read
from the status line's stdin payload (Claude Code does not pass it), and the `theme` value
in `settings.json` may be `"auto"` or may not match the actual terminal background — so this
skill **asks the user** which they use and records the choice in `~/.claude/statusline.theme`
(which the script reads at render time).

The installer is safe and idempotent: it backs up any files it replaces (`*.bak`),
preserves every other key in `settings.json`, and refuses to run if `settings.json`
contains invalid JSON. Re-running it (e.g. to switch themes) simply re-applies the config.

**Procedure:**

1. **Preflight — require Node.js.** Run `node --version`. The status line is a Node.js
   script and is run by Node on every render, so Node must be installed. If `node` is not
   found, tell the user: "This status line requires Node.js, which isn't on your PATH.
   Install Node.js and re-run this skill." and STOP. Do not modify anything.

2. **Ask which theme to use.** The bars need to know whether the terminal is light or dark.
   Use the **AskUserQuestion** tool to ask "Do you use a light or dark terminal background?"
   with two options, **Dark** and **Light**. Present them neutrally — do **not** mark either
   as a default or "(Recommended)"; let the user decide. The user's answer (`light` or
   `dark`) is authoritative.

3. **Run the bundled installer with the chosen theme.** Execute the installer that ships
   with this skill, using the `CLAUDE_SKILL_DIR` environment variable to locate it (it
   points to this skill's own directory), passing the theme as the first argument:
   - bash / macOS / Linux: `node "$CLAUDE_SKILL_DIR/install.js" <light|dark>`
   - Windows PowerShell: `node "$env:CLAUDE_SKILL_DIR\install.js" <light|dark>`

   Pick the form that matches the current shell, substituting the chosen theme. The
   installer:
   - resolves the running user's home directory and ensures `~/.claude` exists,
   - copies the bundled `statusline.js` to `~/.claude/statusline.js` (backing up an
     existing, different copy to `statusline.js.bak`),
   - writes the chosen theme to `~/.claude/statusline.theme` (read by the script at render
     time, since the theme isn't available on stdin),
   - merges a `statusLine` block into `~/.claude/settings.json` with an **absolute** path
     to the copied script (the `statusLine.command` field does not expand `~` or env vars,
     so the absolute path is computed at install time), backing up the prior
     `settings.json` to `settings.json.bak`.

4. **Report the result.** Show the installer's output (theme, script path, settings path,
   and the exact `command` written). Mention any `.bak` backups that were created. Tell the
   user the status line now applies to all future Claude Code sessions, that the **current**
   session may need to be restarted before the bar appears, and that re-running this skill
   lets them switch themes.

5. **Explain what the bar shows** so the user knows what to expect. From left to right:
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

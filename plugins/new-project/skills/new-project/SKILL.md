---
name: new-project
description: Scaffold a new project with GitHub repo, CLAUDE.md, and bash shortcut
user-invocable: true
argument-hint: "<project name> [--public]"
---

Create a new project with full scaffolding: folder, GitHub repo, CLAUDE.md, git init, bash shortcut, and initial push.

**Config file:** `~/.new_project_config` (simple `key=value` format)

**Constants (hardcoded):**
- Default CLAUDE.md repo: `voidmaindev/claude_md` (file: `_default_CLAUDE.md`)
- Bashrc: `~/.bashrc` (current user's home directory, resolved via `$HOME`)

**Procedure:**

1. **Detect GitHub user:**
   - Run `gh api user --jq '.login'` to get the currently authenticated GitHub username.
   - If this fails, the user is not logged in. Tell them to run `gh auth login` and STOP.
   - Store the result as `<github_user>` for all subsequent steps.

2. **Load or create config:**
   - Check if `~/.new_project_config` exists.
   - **If it exists:** read it and extract the `base_path` value. Store it as `<base_path>` for all subsequent steps.
   - **If it does NOT exist (first run):**
     - Ask the user: "Where do you keep your projects? Give me the full path to the folder (e.g., `/home/you/projects` or `/d/MyProjects`)."
     - Wait for the user's answer. Do NOT proceed without it. Do NOT guess or use a default.
     - Validate the path exists by running `ls <path> 2>/dev/null`. If it doesn't exist, ask the user if they want to create it. If yes, run `mkdir -p <path>`. If no, ask for a different path.
     - Write the config file:
       ```bash
       echo "base_path=<user's answer>" > ~/.new_project_config
       ```
     - Confirm to the user: "Saved. Future projects will be created under `<path>`. You can change this anytime by editing `~/.new_project_config`."
   - Store the value as `<base_path>` for all subsequent steps.

3. **Parse arguments from `$ARGUMENTS`:**
   - If `$ARGUMENTS` is empty, ask the user for a project name. Do NOT proceed without one.
   - Check for `--public` or `--private` flags. If `--public` is present, the repo will be public. Default is **private**. Remove the flag from the project name.
   - The remaining text is the project name.
   - Convert the project name to a folder-safe name: replace spaces with underscores, keep hyphens as-is, preserve original casing. Examples: `"doctra admin"` → `doctra_admin`, `"MyProject"` → `MyProject`, `"go-tools"` → `go-tools`.
   - Store the folder name for all subsequent steps.

4. **Pre-flight checks** — Run these checks before making any changes:
   - Check if folder exists: `ls <base_path>/<folder_name>/ 2>/dev/null`
   - Check if GitHub repo exists: `gh repo view <github_user>/<folder_name> 2>/dev/null`
   - If the folder already exists, STOP and tell the user. Ask how to proceed.
   - If the GitHub repo already exists, STOP and tell the user. Ask how to proceed.

5. **Create the project folder:**
   ```bash
   mkdir -p <base_path>/<folder_name>
   ```

6. **Create the GitHub repository:**
   ```bash
   gh repo create <github_user>/<folder_name> --private
   ```
   Use `--public` instead if the user specified `--public` in arguments. Do NOT add `--clone` — we already created the folder.

7. **Generate a unique cc shortcut command:**

   a. **Split the folder name into words** by underscores (`_`), hyphens (`-`), and camelCase/PascalCase boundaries (a lowercase letter followed by an uppercase letter, or consecutive uppercase letters followed by a lowercase letter). Examples:
      - `doctra_admin` → `["doctra", "admin"]`
      - `KernelTools` → `["Kernel", "Tools"]`
      - `go-template` → `["go", "template"]`
      - `GoGST` → `["Go", "GST"]`
      - `Habitus` → `["Habitus"]`

   b. **Build the initial candidate**: Take the first letter of each word, lowercase all, prefix with `cc`.
      - `doctra_admin` → `cc` + `d` + `a` → `ccda`
      - `KernelTools` → `cc` + `k` + `t` → `cckt`
      - `Habitus` → `cc` + `h` → `cch`

   c. **Check uniqueness**: Read `~/.bashrc` and extract all existing function names and aliases that start with `cc` (look for patterns like `ccXXX()` and `alias ccXXX=`). Check if the candidate already exists.

   d. **If the candidate collides**, resolve by progressively adding letters:
      - Try adding the 2nd letter of the 1st word after its existing contribution. Example: `ccda` collides → try `ccdoa` (insert "o", the 2nd letter of "doctra", right after the "d").
      - If still collides, add the 3rd letter of the 1st word: `ccdoca`.
      - If the 1st word is exhausted, add the 2nd letter of the 2nd word.
      - Continue until unique. If all letters exhausted (extremely unlikely), append digit `2`, `3`, etc.

   e. **Announce the chosen command name** to the user before proceeding.

8. **Add the bash function to `.bashrc`:**
   - Append this exact line to `~/.bashrc`:
     ```
     <command_name>() { cd <base_path>/<folder_name> && claude --dangerously-skip-permissions; }
     ```
   - Verify the line was added by reading the last lines of the file.

9. **Fetch the default CLAUDE.md from GitHub:**
   ```bash
   gh api repos/voidmaindev/claude_md/contents/_default_CLAUDE.md --jq '.content' | base64 -d > <base_path>/<folder_name>/CLAUDE.md
   ```
   This fetches `_default_CLAUDE.md` from the `voidmaindev/claude_md` repo and saves it as the new project's `CLAUDE.md`. If the fetch fails (repo not found, file missing, auth issue), report the error and stop.

10. **Initialize git and push:**
   ```bash
   cd <base_path>/<folder_name>
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/<github_user>/<folder_name>.git
   git branch -M main
   git push -u origin main
   ```
   If any step fails, report the error and stop.

11. **Report summary** — Display:
   - Project folder: `<base_path>/<folder_name>`
   - GitHub repo: `https://github.com/<github_user>/<folder_name>`
   - Bash shortcut: `<command_name>` — run it in a new terminal or `source ~/.bashrc` first
   - Repo visibility: public or private
   - Remind: "Run `source ~/.bashrc` or open a new terminal to use `<command_name>`."
   - Remind: "Run `<command_name>` to open Claude in the new project."

**Rules:**
- NEVER proceed without a project name — always ask if missing.
- NEVER overwrite an existing folder or repo without explicit user confirmation.
- NEVER overwrite an existing cc command in .bashrc — always generate a unique name.
- If `gh` CLI is not authenticated, tell the user to run `gh auth login` and stop.
- If any step fails, report the error clearly and stop — do not continue with a broken state.

$ARGUMENTS

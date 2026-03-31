---
name: plugin
description: Plugin marketplace — install, list, remove, and update Claude Code skills from GitHub registries
user-invocable: true
argument-hint: "<list|install|remove|update> [name] [@owner/repo]"
---

Manage Claude Code skills from GitHub-hosted plugin registries.

**Default registry:** `voidmaindev/claude-code-plugins`

**Registry format:** Any GitHub repo with this structure is a valid registry:
```
plugins/
  <plugin_name>/
    SKILL.md
index.json
```

**Subcommands:**

Parse `$ARGUMENTS` to determine the subcommand. The first word is the subcommand, the rest are arguments.

---

## 1. `list`

List available plugins from a registry.

**Usage:**
- `/plugin list` — list from default registry
- `/plugin list @owner/repo` — list from a specific registry

**Procedure:**
1. Determine the registry: if `@owner/repo` is provided, use that. Otherwise use `voidmaindev/claude-code-plugins`.
2. Fetch the index:
   ```bash
   gh api repos/<registry>/contents/index.json --jq '.content' | base64 -d
   ```
3. Parse the JSON and display each plugin's name and description.
4. For each plugin, check if `~/.claude/skills/<name>/SKILL.md` exists locally. If it does, mark it as installed.
5. Display as a table:
   ```
   Available plugins from <registry>:
   
     [installed] new_project — Scaffold a new project with GitHub repo, CLAUDE.md, and bash shortcut
     [ ] some_other_plugin — Description here
   ```

If the fetch fails, report the error (repo not found, not a valid registry, auth issue).

---

## 2. `install`

Install a plugin from a registry.

**Usage:**
- `/plugin install <name>` — install from default registry
- `/plugin install <name>@owner/repo` — install from a specific registry

**Procedure:**
1. Parse the argument: split on `@` to extract `<name>` and optional `<owner/repo>`.
   - `new_project` → name=`new_project`, registry=`voidmaindev/claude-code-plugins`
   - `new_project@somedev/their-plugins` → name=`new_project`, registry=`somedev/their-plugins`
2. Check if `~/.claude/skills/<name>/SKILL.md` already exists. If it does, ask the user if they want to overwrite.
3. Fetch `index.json` from the registry and verify the plugin exists in the index.
4. Fetch the SKILL.md:
   ```bash
   gh api repos/<registry>/contents/plugins/<name>/SKILL.md --jq '.content' | base64 -d
   ```
5. Create the skill folder: `mkdir -p ~/.claude/skills/<name>`
6. Write the content to `~/.claude/skills/<name>/SKILL.md`
7. Write a `.registry` file to track the source:
   ```bash
   echo "registry=<owner/repo>" > ~/.claude/skills/<name>/.registry
   ```
8. Report success: "Installed `<name>` from `<registry>`. You can now use it with `/name`."

If any step fails, report the error and stop.

---

## 3. `remove`

Remove a locally installed plugin.

**Usage:**
- `/plugin remove <name>`

**Procedure:**
1. Check if `~/.claude/skills/<name>/` exists. If not, report "Plugin `<name>` is not installed."
2. Ask the user to confirm: "Remove plugin `<name>`? This will delete `~/.claude/skills/<name>/`."
3. Delete the folder: `rm -rf ~/.claude/skills/<name>/`
4. Report success: "Removed `<name>`."

---

## 4. `update`

Update a plugin to the latest version from its registry.

**Usage:**
- `/plugin update <name>` — update from the registry it was installed from
- `/plugin update <name>@owner/repo` — update from a specific registry (and update the tracked registry)

**Procedure:**
1. Check if `~/.claude/skills/<name>/` exists. If not, report "Plugin `<name>` is not installed."
2. Determine the registry:
   - If `@owner/repo` is provided in the argument, use that.
   - Otherwise, read `~/.claude/skills/<name>/.registry` to find the source registry.
   - If no `.registry` file exists, use the default registry (`voidmaindev/claude-code-plugins`).
3. Fetch the latest SKILL.md from the registry (same as install step 4).
4. Overwrite `~/.claude/skills/<name>/SKILL.md` with the new content.
5. Update the `.registry` file if the registry changed.
6. Report success: "Updated `<name>` from `<registry>`."

---

## Error handling

- If `$ARGUMENTS` is empty or doesn't start with a valid subcommand, show usage help:
  ```
  Usage:
    /plugin list [@owner/repo]
    /plugin install <name> [@owner/repo]
    /plugin remove <name>
    /plugin update <name> [@owner/repo]
  
  Default registry: voidmaindev/claude-code-plugins
  ```
- If `gh` CLI is not authenticated, tell the user to run `gh auth login`.
- If a registry or plugin is not found, report clearly which one failed.

$ARGUMENTS

# Claude Code Plugins

A marketplace for Claude Code skills. Install plugins directly into your Claude Code setup.

## Quick Start

First, install the `plugin` manager skill manually (one-time setup):

1. Create the folder: `mkdir -p ~/.claude/skills/plugin`
2. Download the plugin skill:
   ```bash
   gh api repos/voidmaindev/claude-code-plugins/contents/plugin/SKILL.md --jq '.content' | base64 -d > ~/.claude/skills/plugin/SKILL.md
   ```

Then use it:

```
/plugin list                              # see available plugins
/plugin install new_project               # install a plugin
/plugin install new_project@owner/repo    # install from a different registry
/plugin remove new_project                # uninstall a plugin
/plugin update new_project                # update to latest version
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| `new_project` | Scaffold a new project with GitHub repo, CLAUDE.md, and bash shortcut |

## Creating Your Own Registry

Any GitHub repo can be a plugin registry. Just follow this structure:

```
plugins/
  your_plugin/
    SKILL.md
index.json
```

The `index.json` lists all available plugins:

```json
{
  "plugins": [
    {
      "name": "your_plugin",
      "description": "What it does"
    }
  ]
}
```

Users can install from your registry with:

```
/plugin install your_plugin@your-org/your-repo
```

# voidmaindev Plugins

Claude Code plugin marketplace by voidmaindev.

## Installation

```
/plugin marketplace add voidmaindev/claude-code-plugins
/plugin install new-project@voidmaindev-claude-code-plugins
/plugin install post-init@voidmaindev-claude-code-plugins
/plugin install go-review@voidmaindev-claude-code-plugins
/plugin install cicd-aws@voidmaindev-claude-code-plugins
/plugin install branching@voidmaindev-claude-code-plugins
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| `new-project` | Scaffold a new project with GitHub repo, CLAUDE.md, and bash shortcut |
| `post-init` | Strip project initialization sections from CLAUDE.md after setup is complete |
| `go-review` | Review Go codebase as a senior software architect |
| `cicd-aws` | Set up GitHub Actions CI/CD that deploys a Docker Compose app to EC2 via SSH, with ALB + Cloudflare DNS + SG wiring |
| `branching` | Lock the repo to a hardgated branch+PR workflow — ensure stable & main branches, set stable as default, restrict CI/CD to main, and write the policy into CLAUDE.md |

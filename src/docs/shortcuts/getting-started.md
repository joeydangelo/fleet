---
title: Getting Started
description: Install paw and run your first parallel agent session
category: orchestrator
---

## What is paw?

paw orchestrates parallel AI coding agents across git worktrees — split work,
spawn agents, merge results with full context. Define tasks in a YAML config,
and paw handles worktree creation, agent spawning, progress monitoring,
inter-agent communication, and merge with conflict briefs.

## Install paw

```bash
npm install -g get-paw@latest
```

## Set Up tmux

paw uses tmux for terminal management. Run `paw shortcut setup-tmux` for
platform-specific installation instructions, or use the quick reference:

- **macOS:** `brew install tmux`
- **Linux:** `sudo apt install tmux` (Debian/Ubuntu)
- **Windows:** Run paw from inside WSL (`sudo apt install tmux` in WSL)

Verify: `tmux -V` should print a version.

## First Run

1. **Navigate to a git repository:**

   ```bash
   cd /path/to/your/project
   ```

2. **Set up paw in the repo:**

   ```bash
   paw init
   ```

3. **Open the workspace:**

   ```bash
   paw
   ```

   paw creates a tmux session named `paw-{project}` and drops you into the
   base pane — your workspace. From here you can plan features, write config,
   run claude, or do any work before launching agents.

4. **Define tasks:** Write `.paw/paw.yaml` describing your parallel tasks
   (or run `paw shortcut generate-paw-yaml` to have an agent create it).

5. **Run the full session:**

   ```bash
   paw go
   ```

   This runs `up → launch → watch → merge → down` — creates worktrees,
   spawns agents in tmux panes around you, watches until all agents finish,
   merges results, and cleans up.

## What Gets Created

When you run `paw init` in a project, it creates:

```
your-project/
├── .claude/
│   ├── skills/paw/
│   │   └── SKILL.md              # paw skill for Claude Code
│   ├── scripts/
│   │   ├── paw-session.sh        # SessionStart hook (runs paw prime)
│   │   └── confirm-gh-cli.sh     # Ensures GitHub CLI is available
│   ├── hooks/
│   │   └── paw-done-reminder.sh  # Reminds agents to run paw done
│   └── settings.json             # Claude Code hooks config
├── .paw/                         # Working state (gitignored)
│   ├── paw.yaml                  # Task config
│   └── docs/                     # Bundled shortcuts, guidelines, templates
└── .gitignore                    # .paw/ added automatically
```

- **`.claude/skills/paw/SKILL.md`** — Claude Code skill with full workflow
  guide, command reference, and resource directories.
- **`.paw/`** — working state directory, automatically added to `.gitignore`.
  Contains task config and bundled docs (shortcuts, guidelines, templates).
- **`.claude/settings.json`** — hooks for SessionStart (`paw prime`),
  PreCompact (`paw prime --brief`), and PostToolUse (done reminders).

## Next Steps

- `paw status` — check progress across all tasks
- `paw shortcut generate-paw-yaml` — learn how to write task config
- `paw skill` — full command reference and workflow guide

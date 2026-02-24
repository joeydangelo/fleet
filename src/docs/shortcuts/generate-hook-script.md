---
title: Generate Hook Script
description: Create a custom hook script in .paw/hooks/
category: orchestrator
---
Create or update a hook script in `.paw/hooks/`. Use this when the user wants
custom behavior at a hook point (e.g., Slack notifications after merge, linting
before tests, environment setup).

## Instructions

1. **Which hook event?** paw has two:
   - `post-up` — runs in each worktree after `paw up` creates it
   - `post-merge` — runs after each clean merge in `paw merge`

   If the user hasn't specified, ask which event this hook should fire on.

2. **What should it do?** Get clear requirements from the user. Examples:
   - Install dependencies and run codegen
   - Run tests with coverage
   - Send a Slack webhook on merge
   - Lint staged files

3. **Detect project context.** Check the project's toolchain if the hook
   needs it (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`).

4. **Write the script.**

   ```bash
   mkdir -p .paw/hooks
   ```

   Write to `.paw/hooks/<event>.sh` (e.g., `post-up.sh`, `post-merge.sh`):

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   # <hook logic here>
   ```

   Make it executable:

   ```bash
   chmod +x .paw/hooks/<event>.sh
   ```

5. **Update paw.yaml.** If `.paw/paw.yaml` exists, ensure it references the
   script path:

   ```yaml
   hooks:
     post-up: .paw/hooks/post-up.sh
     post-merge: .paw/hooks/post-merge.sh
   ```

   If paw.yaml doesn't exist yet, tell the user the hook will be picked up
   when they generate the yaml (`paw shortcut generate-paw-yaml`).

6. **Verify.** If possible, run the script directly to confirm it works:

   ```bash
   .paw/hooks/<event>.sh
   ```

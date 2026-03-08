/** Claude Code hook installation for paw agent sessions. */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { success } from './output.js';
import { INBOX_DEBOUNCE_S } from './constants.js';

/** Wrapper script that resolves PATH and ensures paw is installed before running paw commands. */
const PAW_SESSION_SCRIPT = `#!/bin/bash
# Ensure paw CLI is installed and run paw commands for Claude Code sessions
# Installed by: paw init
# This script runs on SessionStart and PreCompact

# Get npm global bin directory (if npm is available)
NPM_GLOBAL_BIN=""
if command -v npm &> /dev/null; then
    NPM_PREFIX=$(npm config get prefix 2>/dev/null)
    if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
        NPM_GLOBAL_BIN="$NPM_PREFIX/bin"
    fi
fi

# Add common binary locations to PATH
export PATH="$NPM_GLOBAL_BIN:$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

# Function to ensure paw is available
ensure_paw() {
    if command -v paw &> /dev/null; then
        return 0
    fi

    echo "[paw] CLI not found, installing..." >&2

    if command -v npm &> /dev/null; then
        npm install -g get-paw 2>/dev/null || {
            mkdir -p ~/.local/bin
            npm install --prefix ~/.local get-paw
            if [ -f ~/.local/node_modules/.bin/paw ]; then
                ln -sf ~/.local/node_modules/.bin/paw ~/.local/bin/paw
            fi
        }
    elif command -v pnpm &> /dev/null; then
        pnpm add -g get-paw
    elif command -v yarn &> /dev/null; then
        yarn global add get-paw
    else
        echo "[paw] ERROR: No package manager found (npm, pnpm, or yarn required)" >&2
        echo "[paw] Please install Node.js and npm, then run: npm install -g get-paw" >&2
        return 1
    fi

    if command -v paw &> /dev/null; then
        return 0
    else
        for dir in "$NPM_GLOBAL_BIN" ~/.local/bin ~/.local/node_modules/.bin /usr/local/bin; do
            if [ -n "$dir" ] && [ -x "$dir/paw" ]; then
                export PATH="$dir:$PATH"
                return 0
            fi
        done
        echo "[paw] Could not locate paw after installation" >&2
        return 1
    fi
}

# Main
ensure_paw || exit 1

# Reviewers get context via their prompt, not paw prime
if [ "$PAW_ROLE" = "reviewer" ]; then
  exit 0
fi

# Run paw prime with any passed arguments (e.g., --brief for PreCompact)
paw prime "$@"

# Signal that session hooks are complete — sendBeacon waits for this file
mkdir -p .paw/run
touch .paw/run/.session-ready
`;

/** PreToolUse hook that blocks dangerous commands and sync state access in paw worktrees. */
const PAW_GUARD_SCRIPT = `#!/bin/bash
# Block dangerous commands and sync state access in paw worktrees
# Installed by: paw init
# Fires on PreToolUse:Bash|Edit|Write, returns permissionDecision:"deny" to prevent execution

input=$(cat)

# Only guard worktrees with active tasks
if ! ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

deny() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"'"$1"'"}}'
  exit 0
}

# Detect tool type from input
tool_name=$(echo "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\(.*\\)"/\\1/')

# Edit/Write guard
if [ "$tool_name" = "Edit" ] || [ "$tool_name" = "Write" ]; then
  file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\\(.*\\)"/\\1/')
  if echo "$file_path" | grep -qE '\\.paw/sync/|\\.paw\\\\\\\\sync\\\\\\\\'; then
    deny "Do not edit files in .paw/sync/. The paw CLI manages all sync state. Manual edits corrupt coordination and break paw watch, paw merge, and paw go. Use paw commands (paw review, paw broadcast, paw status) instead."
  fi
  exit 0
fi

# Bash guard
command=$(echo "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\\(.*\\)"/\\1/')

# Block git checkout / git switch (agents must stay on their task branch)
if echo "$command" | grep -qE '\\bgit\\s+(checkout|switch)\\b'; then
  deny "Do not switch branches in a paw worktree. You are on a dedicated task branch. Stay on it and commit your work here."
fi

# Block git merge (orchestrator's job)
if echo "$command" | grep -qE '\\bgit\\s+merge\\b'; then
  deny "Do not merge branches in a paw worktree. The orchestrator handles merging after all tasks are done."
fi

# Block git push (all work stays local until orchestrator merges)
if echo "$command" | grep -qE '\\bgit\\s+push\\b'; then
  deny "Do not push from a paw worktree. All work stays local until the orchestrator merges."
fi

# Block orchestrator commands from worktrees
if echo "$command" | grep -qE '\\bpaw\\s+(up|down|merge|go|launch|init|watch|nudge)\\b'; then
  deny "Do not run orchestrator commands from a paw worktree. These commands are for the orchestrator in the main repo."
fi

# Block direct access to sync state (state.json, .paw/sync/, paw-sync branch)
# The paw CLI manages all sync state. Manual edits corrupt coordination and break paw watch, merge, and go.
if echo "$command" | grep -qE '\\.paw/sync/'; then
  deny "Do not access .paw/sync/ directly. The paw CLI manages sync state. Manual edits corrupt coordination and break paw watch, paw merge, and paw go. Use paw commands (paw review, paw broadcast, paw status) instead."
fi
if echo "$command" | grep -qE '\\bgit\\s+(show|log|cat-file|diff).*paw-sync'; then
  # Allow read-only git commands on paw-sync (paw-review-reminder uses git show)
  :
elif echo "$command" | grep -qE 'paw-sync'; then
  deny "Do not interact with the paw-sync branch directly. The paw CLI manages this branch. Manual changes corrupt session state and break paw watch, paw merge, and paw go."
fi

exit 0
`;

/** PostToolUse hook that reminds agents to submit for review after committing. */
const PAW_REVIEW_REMINDER_SCRIPT = `#!/bin/bash
# Remind agents to submit for review after committing
# Installed by: paw init
# Fires on PostToolUse:Bash for git commit commands

input=$(cat)

# Remind about paw review on git commit
if [[ "$input" == *"git commit"* ]]; then
  if ls .paw/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .paw/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if task is already in_review or done on sync branch
    task_status=$(git show "paw-sync:state.json" 2>/dev/null | grep -A2 "\\"$task_name\\"" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"/\\1/')
    if [ "$task_status" != "in_review" ] && [ "$task_status" != "done" ]; then
      echo ""
      echo "PAW REMINDER: You have not submitted for review yet."
      echo "  After committing, follow the Publish phase:"
      echo "    1. Write a summary to .paw/summary.md (paw template summary-template)"
      echo "    2. paw review"
      echo ""
    fi
  fi
fi

exit 0
`;

/** Inbox hook for SessionStart and UserPromptSubmit — no debounce, no heartbeat. */
const PAW_INBOX_SCRIPT = `#!/bin/bash
# Check inbox for messages from orchestrator and other agents
# Installed by: paw init
# Fires on SessionStart and UserPromptSubmit

# Only in paw worktrees with active tasks
if ! ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Get npm global bin in PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null)
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

paw inbox

exit 0
`;

/** PostToolUse hook that records heartbeat and checks inbox on every tool use. */
const PAW_HEARTBEAT_SCRIPT = `#!/bin/bash
# Record agent heartbeat and check inbox on every tool use
# Installed by: paw init
# Fires on PostToolUse (all tools)

# Only in paw worktrees with active tasks
if ! ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Get npm global bin in PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null)
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

# Record heartbeat (fast, fire-and-forget)
paw heartbeat &

# Debounced inbox check (every 30s)
LAST_CHECK_FILE=".paw/run/.last-inbox-check"
NOW=$(date +%s)
LAST=0
if [ -f "$LAST_CHECK_FILE" ]; then
  LAST=$(cat "$LAST_CHECK_FILE" 2>/dev/null || echo 0)
fi
ELAPSED=$((NOW - LAST))
if [ "$ELAPSED" -ge ${INBOX_DEBOUNCE_S} ]; then
  echo "$NOW" > "$LAST_CHECK_FILE"
  paw inbox
fi

exit 0
`;

/** SessionStart hook that injects the role-specific SKILL.md content into agent context.
 * Detects role from .paw/tasks/ (builder) vs main repo (orchestrator).
 * Stdout from SessionStart hooks is added directly to Claude's context —
 * the agent gets the full workflow without needing to invoke anything. */
const PAW_SKILL_INJECT_SCRIPT = `#!/bin/bash
# Inject role-specific skill content into agent context at session start
# Installed by: paw init
# Fires on SessionStart — ensures agents have their workflow in context

# PAW_ROLE env var takes precedence (set by paw review for reviewer sessions)
if [ -n "$PAW_ROLE" ]; then
  ROLE="$PAW_ROLE"
elif ls .paw/tasks/*.md 1>/dev/null 2>&1; then
  TASK_COUNT=$(ls .paw/tasks/*.md 2>/dev/null | wc -l)
  if [ "$TASK_COUNT" -eq 1 ]; then
    ROLE="builder"
  else
    ROLE="orchestrator"
  fi
else
  ROLE="orchestrator"
fi

SKILL_FILE=".claude/skills/$ROLE/SKILL.md"
if [ ! -f "$SKILL_FILE" ]; then
  exit 0
fi

# Strip YAML frontmatter (lines between --- markers) and generated comments
sed '/^---$/,/^---$/d; /^<!-- DO NOT EDIT/,/-->/d' "$SKILL_FILE"

exit 0
`;

const SCRIPT_RELATIVE = '.claude/scripts/paw-session.sh';
const SKILL_INJECT_RELATIVE = '.claude/scripts/paw-skill-inject.sh';
const GUARD_RELATIVE = '.claude/hooks/paw-guard.sh';
const REMINDER_RELATIVE = '.claude/hooks/paw-review-reminder.sh';
const HEARTBEAT_RELATIVE = '.claude/hooks/paw-heartbeat.sh';
const INBOX_RELATIVE = '.claude/hooks/paw-inbox.sh';

interface HookHandler {
  type: 'command';
  command: string;
  timeout?: number;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookHandler[];
}

/** Install Claude Code hooks and the wrapper script into a repo. */
export function installHooks(repoRoot: string): void {
  const scriptDir = resolve(repoRoot, '.claude', 'scripts');
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(resolve(repoRoot, SCRIPT_RELATIVE), PAW_SESSION_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, SKILL_INJECT_RELATIVE), PAW_SKILL_INJECT_SCRIPT, 'utf-8');

  const hooksDir = resolve(repoRoot, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(resolve(repoRoot, GUARD_RELATIVE), PAW_GUARD_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, REMINDER_RELATIVE), PAW_REVIEW_REMINDER_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, HEARTBEAT_RELATIVE), PAW_HEARTBEAT_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, INBOX_RELATIVE), PAW_INBOX_SCRIPT, 'utf-8');

  const oldReminderPath = resolve(hooksDir, 'paw-done-reminder.sh');
  try {
    rmSync(oldReminderPath);
  } catch {
    /* already gone */
  }

  const pawHooks: Record<string, MatcherGroup[]> = {
    SessionStart: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${SCRIPT_RELATIVE}`,
          },
        ],
      },
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${SKILL_INJECT_RELATIVE}`,
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${INBOX_RELATIVE}`,
          },
        ],
      },
    ],
    PreCompact: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${SCRIPT_RELATIVE} --brief`,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: 'Bash|Edit|Write',
        hooks: [
          {
            type: 'command',
            command: `bash ${GUARD_RELATIVE}`,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: `bash ${REMINDER_RELATIVE}`,
          },
        ],
      },
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${HEARTBEAT_RELATIVE}`,
          },
        ],
      },
    ],
  };

  const settingsPath = resolve(repoRoot, '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // Corrupted settings -- overwrite
    }
  }

  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const [event, newGroups] of Object.entries(pawHooks)) {
    const current = existing[event] ?? [];
    const filtered = current.filter((entry) => !isPawHookEntry(entry));
    existing[event] = [...filtered, ...newGroups];
  }

  settings.hooks = existing;
  mkdirSync(resolve(settingsPath, '..'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  success('hooks', 'SessionStart + UserPromptSubmit + PreCompact + PreToolUse + PostToolUse');

  success('script', SCRIPT_RELATIVE);
  success('script', SKILL_INJECT_RELATIVE);
  success('script', GUARD_RELATIVE);
  success('script', REMINDER_RELATIVE);
  success('script', HEARTBEAT_RELATIVE);
  success('script', INBOX_RELATIVE);
}

/** Detect any paw-related hook entry (old flat format or correct matcher group). */
function isPawHookEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  /** Old flat format: `{ command: "paw prime --brief" }` */
  if ('command' in obj && typeof obj.command === 'string' && isPawCommand(obj.command)) {
    return true;
  }

  /** Matcher group format: `{ matcher: "", hooks: [{ command: "...paw..." }] }` */
  if ('hooks' in obj && Array.isArray(obj.hooks)) {
    return obj.hooks.some((h: unknown) => {
      if (typeof h !== 'object' || h === null) return false;
      const rec = h as Record<string, unknown>;
      return typeof rec.command === 'string' && isPawCommand(rec.command);
    });
  }

  return false;
}

/** Check if a hook command belongs to paw. */
function isPawCommand(command: string): boolean {
  return command.includes('paw');
}

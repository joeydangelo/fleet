/** Claude Code hook installation for fleet agent sessions. */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { success, toErrorMessage } from './output.js';
import { INBOX_DEBOUNCE_S } from './constants.js';

/** Wrapper script that resolves PATH and ensures fleet is installed before running fleet commands. */
const FLEET_SESSION_SCRIPT = `#!/bin/bash
# Ensure fleet CLI is installed and run fleet commands for Claude Code sessions
# Installed by: fleet init
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

# Function to ensure fleet is available
ensure_fleet() {
    if command -v fleet &> /dev/null; then
        return 0
    fi

    echo "[fleet] CLI not found, installing..." >&2

    if command -v npm &> /dev/null; then
        npm install -g get-fleet 2>/dev/null || {
            mkdir -p ~/.local/bin
            npm install --prefix ~/.local get-fleet
            if [ -f ~/.local/node_modules/.bin/fleet ]; then
                ln -sf ~/.local/node_modules/.bin/fleet ~/.local/bin/fleet
            fi
        }
    elif command -v pnpm &> /dev/null; then
        pnpm add -g get-fleet
    elif command -v yarn &> /dev/null; then
        yarn global add get-fleet
    else
        echo "[fleet] ERROR: No package manager found (npm, pnpm, or yarn required)" >&2
        echo "[fleet] Please install Node.js and npm, then run: npm install -g get-fleet" >&2
        return 1
    fi

    if command -v fleet &> /dev/null; then
        return 0
    else
        for dir in "$NPM_GLOBAL_BIN" ~/.local/bin ~/.local/node_modules/.bin /usr/local/bin; do
            if [ -n "$dir" ] && [ -x "$dir/fleet" ]; then
                export PATH="$dir:$PATH"
                return 0
            fi
        done
        echo "[fleet] Could not locate fleet after installation" >&2
        return 1
    fi
}

# Main
ensure_fleet || exit 1

# Reviewers get context via their prompt, not fleet prime
if [ "$FLEET_ROLE" = "reviewer" ]; then
  exit 0
fi

# Run fleet prime with any passed arguments (e.g., --brief for PreCompact)
fleet prime "$@"

# Signal that session hooks are complete — sendBeacon waits for this file
mkdir -p .fleet/run
touch .fleet/run/.session-ready
`;

/** PreToolUse hook that blocks dangerous commands and sync state access in fleet worktrees. */
const FLEET_GUARD_SCRIPT = `#!/bin/bash
# Block dangerous commands and sync state access in fleet worktrees
# Installed by: fleet init
# Fires on PreToolUse:Bash|Edit|Write, returns permissionDecision:"deny" to prevent execution

input=$(cat)

# Only guard worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
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
  if echo "$file_path" | grep -qE '\\.fleet/sync/|\\.fleet\\\\\\\\sync\\\\\\\\'; then
    deny "Do not edit files in .fleet/sync/. The fleet CLI manages all sync state. Manual edits corrupt coordination and break fleet watch, fleet merge, and fleet go. Use fleet commands (fleet broadcast, fleet send, fleet reply, fleet inbox, fleet summary, fleet review) instead."
  fi
  exit 0
fi

# Bash guard
command=$(echo "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\\(.*\\)"/\\1/')

# Block git checkout / git switch (agents must stay on their task branch)
if echo "$command" | grep -qE '\\bgit\\s+(checkout|switch)\\b'; then
  deny "Do not switch branches in a fleet worktree. You are on a dedicated task branch. Stay on it and commit your work here."
fi

# Block git merge (orchestrator's job)
if echo "$command" | grep -qE '\\bgit\\s+merge\\b'; then
  deny "Do not merge branches in a fleet worktree. The orchestrator handles merging after all tasks are done."
fi

# Block git push (all work stays local until orchestrator merges)
if echo "$command" | grep -qE '\\bgit\\s+push\\b'; then
  deny "Do not push from a fleet worktree. All work stays local until the orchestrator merges."
fi

# Block orchestrator commands from worktrees
if echo "$command" | grep -qE '\\bfleet\\s+(up|down|merge|go|launch|init|watch|nudge)\\b'; then
  deny "Do not run orchestrator commands from a fleet worktree. These commands are for the orchestrator in the main repo."
fi

# Block direct access to sync state (state.json, .fleet/sync/, fleet-sync branch)
# The fleet CLI manages all sync state. Manual edits corrupt coordination and break fleet watch, merge, and go.
if echo "$command" | grep -qE '\\.fleet/sync/'; then
  deny "Do not access .fleet/sync/ directly. The fleet CLI manages sync state. Manual edits corrupt coordination and break fleet watch, fleet merge, and fleet go. Use fleet commands (fleet broadcast, fleet send, fleet reply, fleet inbox, fleet summary, fleet review) instead."
fi
if echo "$command" | grep -qE '\\bgit\\s+(show|log|cat-file|diff).*fleet-sync'; then
  # Allow read-only git commands on fleet-sync (fleet-review-reminder uses git show)
  :
elif echo "$command" | grep -qE 'fleet-sync'; then
  deny "Do not interact with the fleet-sync branch directly. The fleet CLI manages this branch. Manual changes corrupt session state and break fleet watch, fleet merge, and fleet go."
fi

exit 0
`;

/** PreToolUse hook that blocks all tool calls when an agent has unanswered messages. */
const FLEET_INBOX_GATE_SCRIPT = `#!/bin/bash
# Block all tool calls when the agent has unanswered messages
# Installed by: fleet init
# Fires on PreToolUse (all tools), uses exit 2 to block — works even in bypass-permissions mode

input=$(cat)

# Only gate worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Read task name from the task file
task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
task_name=$(basename "$task_file" .md)

# Check for unanswered-message flag file
FLAG_FILE=".fleet/run/.unanswered-\${task_name}"
if [ ! -f "$FLAG_FILE" ]; then
  exit 0
fi

# Flag file exists — check if this is a fleet Bash command (always allowed)
# Extract the command value and check that a command segment starts with "fleet "
if echo "$input" | grep -q '"Bash"'; then
  cmd=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\\(.*\\)".*/\\1/p')
  if echo "$cmd" | grep -qE '(^|&& |; )fleet '; then
    exit 0
  fi
fi

# Deny — exit 2 blocks the tool call even in bypass-permissions mode
# stderr is fed back to the agent as the error message
cat "$FLAG_FILE" >&2
exit 2
`;

/** PostToolUse hook that reminds agents to submit for review after committing. */
const FLEET_REVIEW_REMINDER_SCRIPT = `#!/bin/bash
# Remind agents to submit for review after committing
# Installed by: fleet init
# Fires on PostToolUse:Bash for git commit commands

input=$(cat)

# Remind about fleet review on git commit
if [[ "$input" == *"git commit"* ]]; then
  if ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if task is already in_review or done on sync branch
    task_status=$(git show "fleet-sync:state.json" 2>/dev/null | grep -A2 "\\"$task_name\\"" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"/\\1/')
    if [ "$task_status" != "in_review" ] && [ "$task_status" != "done" ]; then
      echo ""
      echo "FLEET REMINDER: You have not submitted for review yet."
      echo "  After committing, follow the Publish phase:"
      echo "    1. Write your summary: fleet summary <<'EOF' ... EOF"
      echo "    2. Submit for review: fleet review"
      echo ""
    fi
  fi
fi

exit 0
`;

/** Inbox hook for SessionStart and UserPromptSubmit — no debounce, no heartbeat. */
const FLEET_INBOX_SCRIPT = `#!/bin/bash
# Check inbox for messages from orchestrator and other agents
# Installed by: fleet init
# Fires on SessionStart and UserPromptSubmit

# Only in fleet worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Get npm global bin in PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null)
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

fleet inbox

exit 0
`;

/** PostToolUse hook that records heartbeat and checks inbox on every tool use. */
const FLEET_HEARTBEAT_SCRIPT = `#!/bin/bash
# Record agent heartbeat and check inbox on every tool use
# Installed by: fleet init
# Fires on PostToolUse (all tools)

# Only in fleet worktrees with active tasks
if ! ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  exit 0
fi

# Get npm global bin in PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null)
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

# Record heartbeat (fast, fire-and-forget)
fleet heartbeat &

# Debounced inbox check (every 30s)
LAST_CHECK_FILE=".fleet/run/.last-inbox-check"
NOW=$(date +%s)
LAST=0
if [ -f "$LAST_CHECK_FILE" ]; then
  LAST=$(cat "$LAST_CHECK_FILE" 2>/dev/null || echo 0)
fi
ELAPSED=$((NOW - LAST))
if [ "$ELAPSED" -ge ${INBOX_DEBOUNCE_S} ]; then
  echo "$NOW" > "$LAST_CHECK_FILE"
  fleet inbox
fi

exit 0
`;

/** SessionStart hook that injects the role-specific SKILL.md content into agent context.
 * Detects role from .fleet/tasks/ (builder) vs main repo (orchestrator).
 * Stdout from SessionStart hooks is added directly to Claude's context —
 * the agent gets the full workflow without needing to invoke anything. */
const FLEET_SKILL_INJECT_SCRIPT = `#!/bin/bash
# Inject role-specific skill content into agent context at session start
# Installed by: fleet init
# Fires on SessionStart — ensures agents have their workflow in context

# FLEET_ROLE env var takes precedence (set by fleet review for reviewer sessions)
if [ -n "$FLEET_ROLE" ]; then
  ROLE="$FLEET_ROLE"
elif ls .fleet/tasks/*.md 1>/dev/null 2>&1; then
  TASK_COUNT=$(ls .fleet/tasks/*.md 2>/dev/null | wc -l)
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

/** PostToolUse hook that emits tool-level events to the NDJSON feed file. */
const FLEET_FEED_SCRIPT = `#!/bin/bash
# Emit tool-level events to .fleet/run/feed.ndjson
# Installed by: fleet init
# Fires on PostToolUse (all tools)

# Detect task name from .fleet/tasks/*.md
task_file=$(ls .fleet/tasks/*.md 2>/dev/null | head -1)
if [ -n "$task_file" ]; then
  export FLEET_TASK=$(basename "$task_file" .md)
else
  export FLEET_TASK="orchestrator"
fi

mkdir -p .fleet/run
# Pipe stdin directly to node — avoids MAX_ARG_STRLEN limit on large tool outputs
node .claude/hooks/fleet-feed.js

exit 0
`;

/** Node script that parses PostToolUse JSON and emits an NDJSON event line. */
const FLEET_FEED_JS = `const fs = require("fs");
const input = JSON.parse(fs.readFileSync(0, "utf-8"));
const tn = input.tool_name || "";
const ti = input.tool_input || {};
let task = process.env.FLEET_TASK || "orchestrator";
if (process.env.FLEET_ROLE === "reviewer") task += ":reviewer";
const ts = new Date().toTimeString().slice(0, 8);
const feed = ".fleet/run/feed.ndjson";

let ev;
if (tn === "Bash") {
  const cmd = ti.command || "";
  if (cmd.startsWith("fleet ")) process.exit(0);
  if (/\\bgit commit\\b/.test(cmd)) {
    const m = cmd.match(/-m\\s+"([^"]*)"/) || cmd.match(/-m\\s+'([^']*)'/);
    const msg = m ? m[1].slice(0, 50) : "";
    ev = { ts, task, event: "git.commit", msg };
  } else {
    ev = { ts, task, event: "tool.Bash", cmd: cmd.slice(0, 120) };
  }
} else {
  switch (tn) {
    case "Read":
      ev = { ts, task, event: "tool.Read", file: ti.file_path || "" };
      break;
    case "Glob": {
      const o = input.tool_output || "";
      const h = o ? o.split("\\n").filter(Boolean).length : 0;
      ev = { ts, task, event: "tool.Glob", pattern: ti.pattern || "", hits: h };
      break;
    }
    case "Grep": {
      const o = input.tool_output || "";
      const h = o ? o.split("\\n").filter(Boolean).length : 0;
      ev = { ts, task, event: "tool.Grep", pattern: ti.pattern || "", hits: h };
      break;
    }
    case "Edit": {
      const ns = ti.new_string || "";
      const l = ns.split("\\n").length;
      ev = { ts, task, event: "tool.Edit", file: ti.file_path || "", lines: l };
      break;
    }
    case "Write":
      ev = { ts, task, event: "tool.Write", file: ti.file_path || "" };
      break;
    case "Agent":
      ev = { ts, task, event: "tool.Agent", description: ti.description || "" };
      break;
    default:
      ev = { ts, task, event: "tool." + tn };
      break;
  }
}
fs.appendFileSync(feed, JSON.stringify(ev) + "\\n");
`;

const SCRIPT_RELATIVE = '.claude/scripts/fleet-session.sh';
const SKILL_INJECT_RELATIVE = '.claude/scripts/fleet-skill-inject.sh';
const GUARD_RELATIVE = '.claude/hooks/fleet-guard.sh';
const REMINDER_RELATIVE = '.claude/hooks/fleet-review-reminder.sh';
const HEARTBEAT_RELATIVE = '.claude/hooks/fleet-heartbeat.sh';
const INBOX_RELATIVE = '.claude/hooks/fleet-inbox.sh';
const GATE_RELATIVE = '.claude/hooks/fleet-inbox-gate.sh';
const FEED_RELATIVE = '.claude/hooks/fleet-feed.sh';
const FEED_JS_RELATIVE = '.claude/hooks/fleet-feed.js';

interface HookHandler {
  type: 'command';
  command: string;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookHandler[];
}

/** Install Claude Code hooks and the wrapper script into a repo. */
export function installHooks(repoRoot: string): void {
  const scriptDir = resolve(repoRoot, '.claude', 'scripts');
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(resolve(repoRoot, SCRIPT_RELATIVE), FLEET_SESSION_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, SKILL_INJECT_RELATIVE), FLEET_SKILL_INJECT_SCRIPT, 'utf-8');

  const hooksDir = resolve(repoRoot, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(resolve(repoRoot, GUARD_RELATIVE), FLEET_GUARD_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, REMINDER_RELATIVE), FLEET_REVIEW_REMINDER_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, HEARTBEAT_RELATIVE), FLEET_HEARTBEAT_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, INBOX_RELATIVE), FLEET_INBOX_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, GATE_RELATIVE), FLEET_INBOX_GATE_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, FEED_RELATIVE), FLEET_FEED_SCRIPT, 'utf-8');
  writeFileSync(resolve(repoRoot, FEED_JS_RELATIVE), FLEET_FEED_JS, 'utf-8');

  const oldReminderPath = resolve(hooksDir, 'fleet-done-reminder.sh');
  try {
    rmSync(oldReminderPath);
  } catch {
    /* already gone */
  }

  const fleetHooks: Record<string, MatcherGroup[]> = {
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
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${GATE_RELATIVE}`,
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
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${FEED_RELATIVE}`,
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
    } catch (err) {
      console.warn(
        `[fleet] Corrupted settings.json, overwriting with defaults: ${toErrorMessage(err)}`,
      );
    }
  }

  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const [event, newGroups] of Object.entries(fleetHooks)) {
    const current = existing[event] ?? [];
    const filtered = current.filter((entry) => !isFleetHookEntry(entry));
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
  success('script', GATE_RELATIVE);
  success('script', FEED_RELATIVE);
}

/** Detect any fleet-related hook entry (old flat format or correct matcher group). */
function isFleetHookEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  /** Old flat format: `{ command: "fleet prime --brief" }` */
  if ('command' in obj && typeof obj.command === 'string' && isFleetCommand(obj.command)) {
    return true;
  }

  /** Matcher group format: `{ matcher: "", hooks: [{ command: "...fleet..." }] }` */
  if ('hooks' in obj && Array.isArray(obj.hooks)) {
    return obj.hooks.some((h: unknown) => {
      if (typeof h !== 'object' || h === null) return false;
      const rec = h as Record<string, unknown>;
      return typeof rec.command === 'string' && isFleetCommand(rec.command);
    });
  }

  return false;
}

/** Check if a hook command belongs to fleet. */
function isFleetCommand(command: string): boolean {
  return command.includes('fleet');
}

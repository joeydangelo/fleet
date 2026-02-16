/** Claude Code hook installation for paw agent sessions. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { success } from './output.js';

/** Wrapper script that resolves PATH and ensures paw is installed before running paw prime. */
export const PAW_SESSION_SCRIPT = `#!/bin/bash
# Ensure paw CLI is installed and run paw prime for Claude Code sessions
# Installed by: paw setup
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
    else
        echo "[paw] ERROR: No package manager found (npm or pnpm required)" >&2
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

paw prime "$@"
`;

/** PostToolUse hook that reminds agents to run paw done before ending their session. */
export const PAW_DONE_REMINDER_SCRIPT = `#!/bin/bash
# Remind agents to run paw done before ending session
# Installed by: paw setup
# Fires on PostToolUse:Bash for git commit/push commands

input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# Block git push when no remote is configured
if [[ "$command" == git\\ push* ]] || [[ "$command" == *"git push"* ]]; then
  if ! git remote -v 2>/dev/null | grep -q .; then
    echo ""
    echo "PAW WARNING: No git remote configured. Do NOT push."
    echo "  Paw handles merging locally. Skip the push and run 'paw done'."
    echo ""
    exit 2
  fi
fi

# Only trigger on git push or git commit
if [[ "$command" == git\\ push* ]] || [[ "$command" == *"git push"* ]] || \\
   [[ "$command" == git\\ commit* ]] || [[ "$command" == *"git commit"* ]]; then
  # Check if we're in a paw worktree
  if ls .paw/tasks/*.md 1>/dev/null 2>&1; then
    task_file=$(ls .paw/tasks/*.md 2>/dev/null | head -1)
    task_name=$(basename "$task_file" .md)

    # Check if summary exists on sync branch (paw done writes it there)
    if ! git show "paw-sync:summaries/$task_name.md" >/dev/null 2>&1; then
      echo ""
      echo "PAW REMINDER: You have not run 'paw done' yet."
      echo "  Run 'paw done --summary \\"...\\"' before ending your session."
      echo "  Your summary is critical for merge conflict resolution."
      echo ""
    fi
  fi
fi

exit 0
`;

/** SessionStart hook that confirms gh CLI is installed and checks authentication. */
export const CONFIRM_GH_CLI_SCRIPT = `#!/bin/bash
# Confirm GitHub CLI (gh) is available for paw bridge shortcuts
# Installed by: paw setup
# This script runs on SessionStart

# Add common binary locations to PATH
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"

# Check if gh is already installed
if command -v gh &> /dev/null; then
    echo "[gh] CLI found at $(which gh)"
else
    echo "[gh] CLI not found, installing..."

    # Detect platform
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    [ "$ARCH" = "x86_64" ] && ARCH="amd64"
    [ "$ARCH" = "aarch64" ] && ARCH="arm64"

    echo "[gh] Detected platform: \${OS}_\${ARCH}"

    # Get latest version from GitHub API (with fallback)
    GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null \\
        | grep -o '"tag_name": *"v[^"]*"' | head -1 | sed 's/.*"v\\([^"]*\\)".*/\\1/')

    # Fallback version if API fails
    GH_VERSION=\${GH_VERSION:-2.83.1}

    echo "[gh] Version: \${GH_VERSION}"

    # Build download URL based on platform
    if [ "$OS" = "darwin" ]; then
        DOWNLOAD_URL="https://github.com/cli/cli/releases/download/v\${GH_VERSION}/gh_\${GH_VERSION}_macOS_\${ARCH}.zip"
        ARCHIVE_EXT="zip"
    else
        DOWNLOAD_URL="https://github.com/cli/cli/releases/download/v\${GH_VERSION}/gh_\${GH_VERSION}_\${OS}_\${ARCH}.tar.gz"
        ARCHIVE_EXT="tar.gz"
    fi

    echo "[gh] Downloading from \${DOWNLOAD_URL}..."

    # Download
    curl -fsSL -o "/tmp/gh.\${ARCHIVE_EXT}" "$DOWNLOAD_URL"

    # Extract based on archive type
    if [ "$ARCHIVE_EXT" = "zip" ]; then
        unzip -q "/tmp/gh.zip" -d /tmp
        EXTRACT_DIR="/tmp/gh_\${GH_VERSION}_macOS_\${ARCH}"
    else
        tar -xzf "/tmp/gh.tar.gz" -C /tmp
        EXTRACT_DIR="/tmp/gh_\${GH_VERSION}_\${OS}_\${ARCH}"
    fi

    # Install to ~/.local/bin (works in cloud and local)
    mkdir -p ~/.local/bin
    cp "\${EXTRACT_DIR}/bin/gh" ~/.local/bin/gh
    chmod +x ~/.local/bin/gh

    # Clean up
    rm -rf "\${EXTRACT_DIR}" "/tmp/gh.\${ARCHIVE_EXT}"

    echo "[gh] Installed to ~/.local/bin/gh"
fi

# Verify gh is now in PATH
if ! command -v gh &> /dev/null; then
    echo "[gh] ERROR: gh CLI still not found in PATH after installation"
    echo "[gh] Confirm ~/.local/bin is in your PATH"
    exit 1
fi

# Check authentication status
if gh auth status &> /dev/null; then
    echo "[gh] Authenticated successfully"
else
    if [ -n "$GH_TOKEN" ]; then
        echo "[gh] WARNING: GH_TOKEN is set but authentication check failed"
        echo "[gh] Token may be invalid or expired"
    else
        echo "[gh] NOTE: Not authenticated - some operations may require authentication"
        echo "[gh] Run: paw shortcut setup-github-cli"
    fi
fi

exit 0
`;

const SCRIPT_RELATIVE = '.claude/scripts/paw-session.sh';
const GH_SCRIPT_RELATIVE = '.claude/scripts/confirm-gh-cli.sh';
const REMINDER_RELATIVE = '.claude/hooks/paw-done-reminder.sh';

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
  writeFileSync(resolve(repoRoot, GH_SCRIPT_RELATIVE), CONFIRM_GH_CLI_SCRIPT, 'utf-8');

  const hooksDir = resolve(repoRoot, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(resolve(repoRoot, REMINDER_RELATIVE), PAW_DONE_REMINDER_SCRIPT, 'utf-8');

  const pawHooks: Record<string, MatcherGroup[]> = {
    SessionStart: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${GH_SCRIPT_RELATIVE}`,
            timeout: 120,
          },
        ],
      },
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `bash ${SCRIPT_RELATIVE}`,
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
  let changed = false;

  for (const [event, newGroups] of Object.entries(pawHooks)) {
    const current = existing[event] ?? [];

    // Remove any old paw hooks (flat or correct format)
    const filtered = current.filter((entry) => !isPawHookEntry(entry));

    const hadPaw = filtered.length < current.length;
    existing[event] = [...filtered, ...newGroups];

    if (!hadPaw || filtered.length < current.length) {
      changed = true;
    }
  }

  // Always write if we got here -- ensures old formats are replaced
  settings.hooks = existing;
  mkdirSync(resolve(settingsPath, '..'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  if (changed) {
    success('hooks', 'SessionStart + PreCompact + PostToolUse');
  } else {
    success('hooks', 'SessionStart + PreCompact + PostToolUse (updated)');
  }

  success('script', SCRIPT_RELATIVE);
  success('script', GH_SCRIPT_RELATIVE);
  success('script', REMINDER_RELATIVE);
}

/** Detect any paw-related hook entry (old flat format or correct matcher group). */
function isPawHookEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  // Old flat format: { command: "paw prime --brief" }
  if ('command' in obj && typeof obj.command === 'string' && isPawCommand(obj.command)) {
    return true;
  }

  // Correct matcher group format: { matcher: "", hooks: [{ command: "...paw..." }] }
  if ('hooks' in obj && Array.isArray(obj.hooks)) {
    return obj.hooks.some((h: unknown) => {
      if (typeof h !== 'object' || h === null) return false;
      const rec = h as Record<string, unknown>;
      return typeof rec.command === 'string' && isPawCommand(rec.command);
    });
  }

  return false;
}

/** Check if a hook command belongs to paw (includes paw scripts and confirm-gh-cli). */
function isPawCommand(command: string): boolean {
  return command.includes('paw') || command.includes('confirm-gh-cli');
}

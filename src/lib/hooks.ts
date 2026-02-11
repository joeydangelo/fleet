/** Claude Code hook installation for paw agent sessions. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { success, skip } from "./output.js";

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

const SCRIPT_RELATIVE = ".claude/scripts/paw-session.sh";

interface HookHandler {
  type: "command";
  command: string;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookHandler[];
}

/** Install Claude Code hooks and the wrapper script into a repo. */
export function installHooks(repoRoot: string): void {
  const scriptDir = resolve(repoRoot, ".claude", "scripts");
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(resolve(repoRoot, SCRIPT_RELATIVE), PAW_SESSION_SCRIPT, "utf-8");

  const pawHooks: Record<string, MatcherGroup[]> = {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `bash ${SCRIPT_RELATIVE}`,
          },
        ],
      },
    ],
    PreCompact: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `bash ${SCRIPT_RELATIVE} --brief`,
          },
        ],
      },
    ],
  };

  const settingsPath = resolve(repoRoot, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
        string,
        unknown
      >;
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
  mkdirSync(resolve(settingsPath, ".."), { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8",
  );

  if (changed) {
    success("hooks", "SessionStart + PreCompact → paw prime --brief");
  } else {
    success("hooks", "SessionStart + PreCompact (updated)");
  }

  success("script", SCRIPT_RELATIVE);
}

/** Detect any paw-related hook entry (old flat format or correct matcher group). */
function isPawHookEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  // Old flat format: { command: "paw prime --brief" }
  if (
    "command" in obj &&
    typeof obj.command === "string" &&
    obj.command.includes("paw")
  ) {
    return true;
  }

  // Correct matcher group format: { matcher: "", hooks: [{ command: "...paw..." }] }
  if ("hooks" in obj && Array.isArray(obj.hooks)) {
    return obj.hooks.some(
      (h: unknown) =>
        typeof h === "object" &&
        h !== null &&
        "command" in (h as Record<string, unknown>) &&
        typeof (h as Record<string, string>).command === "string" &&
        (h as Record<string, string>).command.includes("paw"),
    );
  }

  return false;
}

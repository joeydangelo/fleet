#!/bin/bash
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

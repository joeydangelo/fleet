#!/bin/bash
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

# Run paw prime with any passed arguments (e.g., --brief for PreCompact)
paw prime "$@"

# Signal that session hooks are complete — sendBeacon waits for this file
mkdir -p .paw/run
touch .paw/run/.session-ready

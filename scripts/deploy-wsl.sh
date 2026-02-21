#!/usr/bin/env bash
# Deploy paw to WSL global install (no sudo needed).
# Run from Git Bash: wsl bash scripts/deploy-wsl.sh
#
# First-time setup: run with --init flag to configure npm prefix and install.
# After code changes: run without flags to quick-update dist files.

set -euo pipefail

PAW_ROOT="/mnt/c/Users/Joe D/repos/paw"
NPM_GLOBAL="$HOME/.npm-global"

setup_npm_prefix() {
  if [ "$(npm config get prefix)" = "/usr" ]; then
    echo "Configuring npm to use user-space global prefix..."
    mkdir -p "$NPM_GLOBAL"
    npm config set prefix "$NPM_GLOBAL"

    # Add to PATH if not already there
    if ! grep -q 'npm-global/bin' "$HOME/.bashrc" 2>/dev/null; then
      echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
    fi
    export PATH="$NPM_GLOBAL/bin:$PATH"
    echo "Done. npm global prefix: $NPM_GLOBAL"
  fi
}

full_install() {
  setup_npm_prefix
  cd "$PAW_ROOT"
  echo "Building..."
  pnpm build
  echo "Packing..."
  npm pack --quiet
  echo "Installing globally..."
  npm install -g ./get-paw-0.1.0.tgz
  rm -f ./get-paw-0.1.0.tgz
  echo "Installed: $(which paw) → $(paw --version)"
}

quick_update() {
  cd "$PAW_ROOT"
  echo "Building..."
  pnpm build

  # Find the global install location
  local prefix
  prefix="$(npm config get prefix)"
  local dest="$prefix/lib/node_modules/get-paw/dist"

  if [ ! -d "$dest" ]; then
    echo "Global install not found at $dest. Run with --init first."
    exit 1
  fi

  echo "Copying dist → $dest"
  cp -r dist/* "$dest/"
  echo "Updated: $(paw --version)"
}

case "${1:-}" in
  --init)
    full_install
    ;;
  *)
    quick_update
    ;;
esac

---
name: setup-tmux
description: Ensure tmux is installed for paw's terminal management
---
paw requires tmux for `paw`, `paw launch`, and `paw go`.

## Verify First

```bash
tmux -V
```

If this prints a version (e.g., `tmux 3.4`), you're done.

## Install

### macOS

```bash
brew install tmux
```

### Linux

Ubuntu/Debian:

```bash
sudo apt install tmux
```

Fedora/RHEL:

```bash
sudo dnf install tmux
```

Arch Linux:

```bash
sudo pacman -S tmux
```

### Windows (WSL2)

paw on Windows runs inside WSL.

If WSL is not installed (PowerShell as Admin):

```powershell
wsl --install
```

Then inside WSL:

```bash
sudo apt update
sudo apt install tmux
```

## Verify

```bash
tmux -V       # should print version
paw           # opens TUI in tmux session
```

On Windows, run paw from inside a WSL terminal.

## Reference

- https://tmux.info/docs/installation
- https://github.com/tmux/tmux/wiki/Getting-Started

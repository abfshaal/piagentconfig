#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
backup_dir="$agent_dir/backups/$(date +%Y%m%d%H%M%S)"

mkdir -p "$agent_dir"

backup_copy() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
    mkdir -p "$backup_dir"
    cp "$dst" "$backup_dir/$(basename "$dst")"
  fi
  cp "$src" "$dst"
}

# Copy machine-safe config. Secrets are intentionally not in this repo.
backup_copy "$repo_dir/config/settings.json" "$agent_dir/settings.json"
backup_copy "$repo_dir/config/models.json" "$agent_dir/models.json"
backup_copy "$repo_dir/config/keybindings.json" "$agent_dir/keybindings.json"
backup_copy "$repo_dir/config/plannotator.json" "$agent_dir/plannotator.json"
backup_copy "$repo_dir/config/AGENTS.md" "$agent_dir/AGENTS.md"
backup_copy "$repo_dir/config/APPEND_SYSTEM.md" "$agent_dir/APPEND_SYSTEM.md"
backup_copy "$repo_dir/config/SYSTEM.md" "$agent_dir/SYSTEM.md"

# Add this checkout as a local Pi package, preserving any packages already in settings.
python3 - "$agent_dir/settings.json" "$repo_dir" <<'PY'
import json
import os
import sys

settings_path, repo_dir = sys.argv[1], os.path.abspath(sys.argv[2])
try:
    with open(settings_path, "r", encoding="utf-8") as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

packages = settings.get("packages")
if not isinstance(packages, list):
    packages = []

def identity(entry):
    if isinstance(entry, str):
        return os.path.abspath(os.path.expanduser(entry)) if entry.startswith(("/", "~", ".")) else entry
    if isinstance(entry, dict):
        source = entry.get("source")
        if isinstance(source, str):
            return os.path.abspath(os.path.expanduser(source)) if source.startswith(("/", "~", ".")) else source
    return repr(entry)

repo_id = os.path.abspath(repo_dir)
if all(identity(package) != repo_id for package in packages):
    packages.append(repo_dir)
settings["packages"] = packages

with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY

# Install package deps used by extensions, if Node/npm exist.
if command -v npm >/dev/null 2>&1; then
  (cd "$repo_dir" && npm install --omit=dev --legacy-peer-deps)
else
  echo "npm not found. Install Node/npm before using extensions with dependencies." >&2
fi

cat <<EOF
Pi agent setup installed.

Repo: $repo_dir
Pi config dir: $agent_dir
Backups, if changed: $backup_dir

Next:
  1. Start/restart pi, or run /reload inside pi.
  2. Run /login on this machine. auth.json is never synced.
  3. If using Ollama config, run: ollama pull qwen3-coder-next:q4_K_M
EOF

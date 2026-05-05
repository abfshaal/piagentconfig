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

backup_copy "$repo_dir/config/settings.json" "$agent_dir/settings.json"
backup_copy "$repo_dir/config/models.json" "$agent_dir/models.json"
backup_copy "$repo_dir/config/keybindings.json" "$agent_dir/keybindings.json"
backup_copy "$repo_dir/config/plannotator.json" "$agent_dir/plannotator.json"

python3 - "$agent_dir/settings.json" "$repo_dir" <<'PY'
import json, os, sys
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
        src = entry.get("source")
        if isinstance(src, str):
            return os.path.abspath(os.path.expanduser(src)) if src.startswith(("/", "~", ".")) else src
    return repr(entry)

repo_id = os.path.abspath(repo_dir)
if all(identity(p) != repo_id for p in packages):
    packages.append(repo_dir)
settings["packages"] = packages
with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY

if command -v npm >/dev/null 2>&1; then
  (cd "$repo_dir" && npm install --omit=dev --legacy-peer-deps)
else
  echo "npm not found; install Node/npm before using extensions with dependencies." >&2
fi

cat <<EOF
Pi setup installed.

Config dir: $agent_dir
Package path added to settings.json: $repo_dir
Backups, if any: $backup_dir

Next:
  1. Restart pi or run /reload.
  2. Run /login on each new machine. auth.json is not synced.
  3. If using Ollama provider, install/start Ollama and pull model qwen3-coder-next:q4_K_M.
EOF

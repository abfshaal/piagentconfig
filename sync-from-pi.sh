#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

mkdir -p \
  "$repo_dir/agents" \
  "$repo_dir/extensions" \
  "$repo_dir/prompts" \
  "$repo_dir/skills" \
  "$repo_dir/themes" \
  "$repo_dir/patches" \
  "$repo_dir/config"

sync_dir() {
  local name="$1"
  if [[ -d "$agent_dir/$name" ]]; then
    rsync -a --delete \
      --exclude 'node_modules/' \
      --exclude '.DS_Store' \
      --exclude '*.bak*' \
      --exclude '*.disabled*' \
      --exclude 'backups/' \
      "$agent_dir/$name/" "$repo_dir/$name/"
  fi
}

sync_dir agents
sync_dir extensions
sync_dir prompts
sync_dir skills
sync_dir themes
sync_dir patches

for file in settings.json models.json keybindings.json plannotator.json AGENTS.md APPEND_SYSTEM.md SYSTEM.md; do
  if [[ -f "$agent_dir/$file" ]]; then
    cp "$agent_dir/$file" "$repo_dir/config/$file"
  else
    rm -f "$repo_dir/config/$file"
  fi
done

# Safety cleanup: never keep generated deps or obvious secrets in repo tree.
find "$repo_dir" -path "$repo_dir/.git" -prune -o -path '*/node_modules' -type d -prune -exec rm -rf {} +
find "$repo_dir" -path "$repo_dir/.git" -prune -o \
  \( -name auth.json -o -name trust.json -o -name run-history.jsonl -o -path '*/sessions/*' -o -name '.env' -o -name '.env.*' \) -print

cat <<'EOF'
Sync complete.

Review before push:
  git status
  git diff
  npm run check:secrets
EOF

#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

mkdir -p "$repo_dir/extensions" "$repo_dir/skills" "$repo_dir/config" "$repo_dir/patches"

rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '*.bak*' \
  --exclude '*.disabled*' \
  --exclude '.DS_Store' \
  "$agent_dir/extensions/" "$repo_dir/extensions/"

rsync -a --delete --exclude '.DS_Store' "$agent_dir/skills/" "$repo_dir/skills/"

for f in settings.json models.json keybindings.json plannotator.json; do
  if [[ -f "$agent_dir/$f" ]]; then
    cp "$agent_dir/$f" "$repo_dir/config/$f"
  fi
done

if [[ -d "$agent_dir/patches" ]]; then
  find "$agent_dir/patches" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.md' -o -name '*.patch' \) -print0 | while IFS= read -r -d '' f; do
    cp "$f" "$repo_dir/patches/"
  done
fi

find "$repo_dir" \( -path "$repo_dir/.git" -o -path "$repo_dir/node_modules" \) -prune -o \
  \( -name auth.json -o -path '*/sessions/*' -o -name '*.bak*' -o -name '*.disabled*' \) -print

cat <<'EOF'
Sync complete.
Review before commit:
  git status
  git diff
  npm run check:secrets
EOF

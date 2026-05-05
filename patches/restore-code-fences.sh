#!/usr/bin/env bash
set -euo pipefail

GLOBAL_ROOT="$(npm root -g)"
TARGET="$GLOBAL_ROOT/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui/dist/components/markdown.js"
BACKUP_DIR="$HOME/.pi/agent/patches/backups"
ORIGINAL="$BACKUP_DIR/markdown.js.original"
BACKUP_TO_RESTORE="${1:-$ORIGINAL}"

if [[ ! -f "$TARGET" ]]; then
  echo "Target not found: $TARGET" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_TO_RESTORE" ]]; then
  echo "Backup not found: $BACKUP_TO_RESTORE" >&2
  echo "Available backups:" >&2
  ls -1 "$BACKUP_DIR"/markdown.js.* 2>/dev/null >&2 || true
  exit 1
fi

cp "$TARGET" "$BACKUP_DIR/markdown.js.before-restore.$(date +%Y%m%d%H%M%S).bak"
cp "$BACKUP_TO_RESTORE" "$TARGET"
echo "Restored $TARGET from $BACKUP_TO_RESTORE"

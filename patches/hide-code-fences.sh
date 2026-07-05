#!/usr/bin/env bash
set -euo pipefail

# NOTE: this patches pi's bundled pi-tui in place. It breaks (exits 1, no harm done)
# whenever a pi update reformats markdown.js — rerun after every pi update.
GLOBAL_ROOT="$(npm root -g)"
TARGET=""
for SCOPE in "@earendil-works" "@mariozechner"; do
  CANDIDATE="$GLOBAL_ROOT/$SCOPE/pi-coding-agent/node_modules/$SCOPE/pi-tui/dist/components/markdown.js"
  if [[ -f "$CANDIDATE" ]]; then
    TARGET="$CANDIDATE"
    break
  fi
done
BACKUP_DIR="$HOME/.pi/agent/patches/backups"
ORIGINAL="$BACKUP_DIR/markdown.js.original"
STAMPED="$BACKUP_DIR/markdown.js.$(date +%Y%m%d%H%M%S).bak"

if [[ -z "$TARGET" ]]; then
  echo "Target markdown.js not found under @earendil-works or @mariozechner in $GLOBAL_ROOT" >&2
  exit 1
fi

# keep only the most recent stamped backup to avoid accumulation
ls -1t "$BACKUP_DIR"/markdown.js.*.bak 2>/dev/null | tail -n +2 | xargs rm -f 2>/dev/null || true

mkdir -p "$BACKUP_DIR"
cp "$TARGET" "$STAMPED"
if [[ ! -f "$ORIGINAL" ]]; then
  cp "$TARGET" "$ORIGINAL"
fi

TARGET="$TARGET" node <<'NODE'
const fs = require('node:fs');
const target = process.env.TARGET;
const input = fs.readFileSync(target, 'utf8');
let replacements = 0;
const output = input.split('\n').map((line) => {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  if (line.includes('lines.push(this.theme.codeBlockBorder') && line.includes('token.lang')) {
    replacements++;
    return `${indent}// pi-user-patch: hidden opening code fence border`;
  }
  if (line.includes('lines.push(this.theme.codeBlockBorder') && line.includes('"```"')) {
    replacements++;
    return `${indent}// pi-user-patch: hidden closing code fence border`;
  }
  return line;
}).join('\n');

if (replacements === 0) {
  if (input.includes('pi-user-patch: hidden opening code fence border')) {
    console.log('Already patched: code fence borders hidden.');
    process.exit(0);
  }
  console.error('No matching code fence border lines found. Pi renderer may have changed.');
  process.exit(1);
}

fs.writeFileSync(target, output, 'utf8');
console.log(`Patched ${replacements} code fence border line(s) in ${target}`);
NODE

echo "Stamped backup: $STAMPED"
echo "Original backup: $ORIGINAL"

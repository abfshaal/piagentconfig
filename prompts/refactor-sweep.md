---
description: Quick behavior-preserving cleanup pass for current diff or local target
argument-hint: "[target|--diff|--from <start> --to <end>|--range <start>..<end>] [--implement] [--no-commit] [--hitl]"
---

You are running staged workflow command `/refactor-sweep`.

Target / flags: `$ARGUMENTS`

Load the `refactor-sweep` skill and follow it exactly; it is the single source of truth for this command. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/refactor-sweep/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise.

Default mode is plan/report only — do not edit code unless `--implement` is present. Preserve behavior. Write exactly one durable artifact, include exactly one F2 artifact tag on its own line, then stop.

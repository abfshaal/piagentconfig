---
description: Alias for /compressed alignment quick staged flow
argument-hint: "alignment <request-or-artifact> [--plan-only|--implement|--no-commit|--hitl]"
---

You are running alias command `/compressed alignment`. This command is an alias of `/compressed-alignment` and passes all flags through unchanged.

Raw arguments: `$ARGUMENTS`

Load the `compressed-alignment` skill and follow it exactly; it is the single source of truth for this stage, including how alias arguments are parsed. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/compressed-alignment/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

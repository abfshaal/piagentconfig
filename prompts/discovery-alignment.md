---
description: Run codebase-grounded Discovery + Alignment for a feature idea
argument-hint: "<feature idea>"
---

You are running staged workflow command `/discovery-alignment`.

Feature idea: `$ARGUMENTS`

Load the `discovery-alignment` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/discovery-alignment/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

---
description: Diagnose code debt with measurements and rank refactor candidates by leverage
argument-hint: "<target area|recent changes|repo concern>"
---

You are running staged workflow command `/refactor-discovery`.

Target: `$ARGUMENTS`

Load the `refactor-discovery` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/refactor-discovery/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. No code edits, no commits. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

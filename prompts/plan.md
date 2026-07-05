---
description: Draft and review an implementation task plan from approved design
argument-hint: "<design-artifact-path>"
---

You are running staged workflow command `/plan`.

Design artifact path: `$ARGUMENTS`

Load the `task-planning` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/task-planning/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

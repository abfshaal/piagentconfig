---
description: Turn a refactor baseline into a reviewed Mikado plan of atomic green-to-green transformation steps
argument-hint: "<refactor-baseline-artifact-path>"
---

You are running staged workflow command `/refactor-plan`.

Baseline artifact path: `$ARGUMENTS`

Load the `refactor-plan` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/refactor-plan/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. Planning only; no file edits. A fresh `refactor-plan-reviewer` pass is mandatory before approval. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

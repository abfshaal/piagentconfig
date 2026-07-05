---
description: Pin current behavior with characterization tests and freeze/flex compatibility surfaces before refactoring
argument-hint: "<refactor-discovery-artifact-path> [candidate-id]"
---

You are running staged workflow command `/refactor-baseline`.

Discovery artifact / candidate: `$ARGUMENTS`

Load the `refactor-baseline` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/refactor-baseline/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Run only this stage. Test-only edits allowed (characterization tests); no production-code edits. Write exactly one durable stage artifact, include exactly one F2 artifact tag on its own line, state the next command only when the artifact status allows it, then stop.

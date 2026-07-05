---
description: Execute an approved Mikado refactor plan step by step with equivalence checks and revert-don't-fix-forward bail-out
argument-hint: "<refactor-plan-artifact-path>"
---

You are running staged workflow command `/implement-refactor`.

Plan artifact path: `$ARGUMENTS`

Load the `implement-refactor` skill and follow it exactly; it is the single source of truth for this stage. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/implement-refactor/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise the stage flow.

Start only from `Status: APPROVED_FOR_REFACTOR`. One writer at a time; per-step commits; on equivalence divergence revert and re-plan, never fix forward. Write exactly one report artifact, include the F2 report tag plus one status tag on their own lines, then stop.

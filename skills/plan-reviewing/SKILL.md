---
name: plan-reviewing
description: Mandatory plan review for the staged workflow. Use only inside `/plan` before a plan is approved for implementation.
---

# Plan Reviewing

Purpose: prevent bad plans from becoming implementation contracts.

## Rules

- Review the draft plan before final artifact is written.
- Use fresh context.
- Review only; do not edit code.
- Check source discovery/spec/design artifacts.
- Return `PASS`, `PASS_WITH_NOTES`, `BLOCKED`, or `NEEDS_DECISION`.
- Parent fixes or asks questions; reviewer does not ask user directly.
- Treat any open question in the draft as `NEEDS_DECISION` unless it is purely informational and does not affect execution, validation, scope, or review.
- Treat any material risk without accepted/mitigated/deferred/blocking disposition as `NEEDS_DECISION`.

## Review checklist

- Every acceptance criterion maps to tasks.
- Non-goals do not leak into tasks.
- Tasks are vertical slices.
- Each task has AFK/HITL validation mode, goal, reuse-first, likely files, baseline validation/reproduction when relevant, review scope, commit scope, commit message seed, dependencies, TDD, validation, documentation/release impact, non-functional validation when relevant, non-goals, escalation triggers.
- `HITL` means implement first, then pause for human/manual validation before commit/continue. It does not mean block implementation start.
- Validation is runnable or manual validation is explicit.
- Dependencies and ordering are clear.
- No unapproved schema/API/product/architecture choices remain.
- No open questions remain in an approvable plan.
- Material risks have explicit accepted/mitigated/deferred/blocking dispositions.
- Fresh implementer can execute without guessing.

## Blocker examples

- vague task like “wire backend” with no files or validation
- task requires new DB table without approved design
- missing acceptance criterion coverage
- task adds scope beyond non-goals
- no validation path for high-risk behavior
- risk listed without user acceptance, mitigation, deferral as non-goal, or blocker status
- “Questions for implementer” or “open questions” present in an otherwise approved plan

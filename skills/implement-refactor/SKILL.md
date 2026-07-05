---
name: implement-refactor
description: Heavy refactor workflow stage 4 — step executor. Use only when invoked by `/implement-refactor`; executes an approved Mikado plan one transformation step at a time with equivalence checks against the golden baseline and a revert-don't-fix-forward bail-out protocol.
---

# Implement Refactor (Step Executor)

Purpose: execute approved transformation steps. Same behavior — proven by equivalence against the golden baseline — simpler code.

The failure protocol is the defining difference from feature implementation: when a step diverges, you REVERT and re-plan; you never fix forward through a red equivalence check.

## Rules

- Command-only. Do not trigger from ordinary requests.
- Start only from `Status: APPROVED_FOR_REFACTOR` plan with no open questions.
- Read plan + baseline + discovery artifacts. The golden baseline in the baseline artifact is the only equivalence oracle.
- Parent owns orchestration, staging, commits, user questions. One writer at a time. Child agents never commit or ask the user.
- Steps run in plan dependency order. Never reorder, merge, or split steps silently.
- Quarantined bugs stay quarantined. Pinned failures must still fail identically after every step.
- Never use `git add .`. Stage only step files.
- Write one report under `.scratch/agent-workflow/refactor/reports/`.
- Use `stage_progress` when available: full step queue, current step, phase (transform/equivalence/review/commit), blocked/done.

## Per-step loop

1. Confirm clean state: working tree clean of step-unrelated changes; previous step committed; record `STEP_BASE_SHA`.
2. Pre-check: run the step's equivalence commands once; outcomes must equal the golden baseline. If not, STOP — the world drifted; report `BLOCKED`.
3. Transform: for wide mechanical steps (rename/move), prefer tooling/codemod run by parent. Otherwise launch one `refactor-implementer` with exactly this step's text plus plan/baseline paths.
4. Scope check: diff against `STEP_BASE_SHA` must touch only the step's target ± its mechanical fallout. The implementer reports `SCOPE_DIVERGED` when it cannot stay inside the step; treat any unexplained extra hunks the same way.
5. Equivalence check: run the step's commands. Outcomes must be identical to the golden baseline — same passes, same pinned failures with same signatures.
6. On divergence or scope divergence → **bail out** (below). On green → continue.
7. Review: `behavior-preservation-reviewer` with step text, diff, baseline artifact path, equivalence evidence. For steps that add/move abstractions, also `reuse-reviewer`. `code-quality-reviewer` only when the step wrote non-mechanical code. Reviewer must-fix findings: apply via one targeted fix pass, re-run equivalence, re-review.
8. Commit the step: stage step files only, verify staged diff, commit with the step's message seed, record SHA.
9. Update progress; next step.

## Bail-out protocol

When equivalence diverges or scope diverges:

1. Do not attempt a forward fix. Do not commit.
2. Discard the step's working-tree changes. This is a destructive git operation: request runtime approval, state exactly which files revert and why. If approval is refused, stop with `BLOCKED`.
3. Diagnose which hidden prerequisite caused the divergence (a Mikado discovery, e.g. "callers also depend on ordering").
4. Insert the prerequisite as a new step before the failed one — by updating the plan artifact's step graph and noting `Plan amended: <reason>` — when it is a pure transformation that fits the catalog and touches no FROZEN surface. Then retry from the new step.
5. If the prerequisite is NOT a pure transformation (behavior must change, a FROZEN surface blocks, tolerance is wrong), stop with `NEEDS_DECISION` and route the question: tolerance/coverage → `/refactor-baseline`; step design → `/refactor-plan`.
6. Record every bail-out in the report: step, divergence evidence, prerequisite discovered, action taken.

## Finish

After the last step:

1. Run the full golden baseline set one final time; record outcomes.
2. Re-run the discovery friction probe: measure the friction story's cost now (files/call sites/test edits for the representative change) and compare with the today-cost recorded in discovery.
3. Compute the actual complexity delta (counts) vs the plan's expected delta.
4. Quarantine audit: every quarantined item still fails identically; none silently fixed.
5. Write report; status `COMPLETE` / `PARTIAL` / `BLOCKED` / `NEEDS_HUMAN_VALIDATION`.

## Report template

```markdown
# Refactor Implementation Report: <candidate>

Date: <date>
Status: COMPLETE | PARTIAL | BLOCKED | NEEDS_HUMAN_VALIDATION
Source plan: <path>
Source baseline: <path>
Baseline SHA: <sha>

## Steps executed

| Step | Transformation | Status | Commit | Equivalence | Bail-outs |
|---|---|---|---|---|---|

## Bail-out log

| Step | Divergence evidence | Prerequisite discovered | Action |
|---|---|---|---|

## Final equivalence evidence

| Command | Golden outcome | Final outcome | Identical |
|---|---|---|---|

## Friction story re-probe

| Story | Cost before (from discovery) | Cost now | Improvement |
|---|---|---|---|

## Complexity delta (actual vs planned)

| Metric | Planned | Actual |
|---|---|---|

## Quarantine audit

## Review summary

## Commits

| Step | Commit SHA | Message |
|---|---|---|

## Blockers / decisions needed

## Remaining steps
```

## F2 tag rules

Report paths in tags must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs.

- `[REFACTOR-IMPLEMENTATION-REPORT:<path>]` always, plus one of:
- `[REFACTOR-COMPLETE:<path>]` · `[REFACTOR-PARTIAL:<path>]` · `[REFACTOR-BLOCKED:<path>]`

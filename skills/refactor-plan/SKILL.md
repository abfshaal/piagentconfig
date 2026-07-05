---
name: refactor-plan
description: Heavy refactor workflow stage 3 — Mikado transformation plan. Use only when invoked by `/refactor-plan`; turns a characterization baseline into a dependency-ordered sequence of named, atomic, green-to-green transformation steps reviewed by refactor-plan-reviewer.
---

# Refactor Plan (Mikado Transformation Sequence)

Purpose: turn an approved baseline into an ordered sequence of atomic transformations, each of which keeps every baseline check green.

This is not feature task planning. There are no vertical slices, no TDD RED, no new acceptance criteria. The plan is a dependency graph of known transformations; the invariant for every step is GREEN → GREEN: the golden baseline passes identically before and after.

## Rules

- Command-only. Do not trigger from ordinary requests.
- Planning only. Do not edit files.
- Source gate: continue only when the baseline artifact status is `READY_FOR_PLAN`. Otherwise write a `Status: BLOCKED` plan artifact, recommend `/refactor-baseline`, and stop.
- Read the baseline artifact and linked discovery artifact fully. The behavior contract and surface dispositions come FROM the baseline — do not re-derive or re-ask them.
- Always run fresh `refactor-plan-reviewer` before approving. Mandatory. Re-run if fixes change step structure, ordering, equivalence checks, or surface handling.
- Every FROZEN surface stays untouched; every MIGRATE surface changes only via a parallel-change (expand → migrate callers → contract) step triplet.
- Quarantined bugs stay quarantined: no step fixes them; pinned-odd behavior is preserved.
- Prefer deletion/consolidation steps before any step that adds an abstraction. A new seam needs two real adapters or an explicit approved near-term need.
- Write one artifact under `.scratch/agent-workflow/refactor/plans/`.
- Ensure `.scratch/` is ignored via `.git/info/exclude` when inside git.
- Stop after artifact summary, one F2 tag, and next command.

## Step properties (all mandatory)

Every step must be:

- **Named**: a transformation from the catalog below, not "clean up X".
- **Atomic**: one transformation, one commit, smallest coherent unit.
- **Green-to-green**: the golden baseline passes identically after the step. No step may end red.
- **Revertible**: `git revert` of its commit restores prior state without touching other steps.
- **Ordered**: prerequisites listed; a step may only depend on earlier steps (Mikado: leaves first). If implementation discovers a hidden prerequisite, that becomes a NEW step inserted before — never absorbed into the current one.
- **Mechanical where possible**: renames/moves via LSP/IDE tooling or scripted codemods, not hand-edits, when the blast radius is wide.

## Transformation catalog (step names)

extract function/module · inline function/module · move function/field · rename (tool-assisted) · consolidate duplicates · delete dead code · introduce seam (requires two-adapter justification) · parallel change expand / migrate / contract · replace conditional with polymorphism (or inverse) · encapsulate field/collection · split module · merge modules · move test toward interface

If a needed change does not fit a named transformation, it is probably a behavior change — send it back to the user as `NEEDS_DECISION`.

## Required step fields

- step id + transformation name
- target (files/symbols)
- prerequisite step ids (or none)
- mechanical recipe (commands/tool actions where applicable)
- equivalence check: the exact baseline commands to run after the step (usually the full golden set; a justified subset only for pure-rename steps) and the rule "outcomes identical to golden baseline, including pinned failures"
- surfaces touched + their baseline disposition (must be FLEX/MIGRATE; FROZEN = step is invalid)
- expected complexity delta (concrete counts: files deleted, call sites simplified, wrappers removed)
- revert cost (trivially revertible / revertible-with-conflicts / hard — hard requires splitting)
- commit message seed (`refactor(<step-id>): <transformation> <target>`)
- escalation triggers

## Plan is not approved when

- any step touches a FROZEN surface
- any MIGRATE surface changes without a parallel-change triplet
- any step lacks an equivalence check or could end red
- any step is unnamed/un-atomic/not independently revertible
- ordering has cycles or forward dependencies
- an abstraction-adding step precedes an attempted deletion/consolidation alternative
- a quarantined bug gets fixed or unpinned
- expected complexity delta across the plan is not concretely positive (counts, not adjectives)
- reviewer returned `BLOCKED`/`NEEDS_DECISION` unresolved

## Required flow

1. Validate baseline artifact path; gate on status.
2. Read baseline + discovery artifacts fully. Inspect target code as needed to draft real steps (bounded reads).
3. Draft the step sequence honoring all step properties. Include seam-creation constraints from the baseline as the earliest steps.
4. Run fresh `refactor-plan-reviewer` with baseline + plan paths. Apply accepted fixes; re-run when structure changed.
5. Planning-level open questions → ask user one at a time; upstream (tolerance/coverage) questions → write `NEEDS_DECISION` artifact recommending `/refactor-baseline` and stop.
6. Write artifact: `.scratch/agent-workflow/refactor/plans/YYYY-MM-DD-<slug>-refactor-plan.md`.
7. Final response: artifact path, review status, step count, expected total complexity delta, exactly one F2 tag, next command `/implement-refactor <artifact-path>` only when `APPROVED_FOR_REFACTOR`. Stop.

## Artifact template

```markdown
# Refactor Plan: <candidate>

Date: <date>
Status: APPROVED_FOR_REFACTOR | NEEDS_DECISION | BLOCKED
Source baseline: <path>
Source discovery: <path>
Plan review status: PASS | PASS_WITH_NOTES | NEEDS_DECISION | BLOCKED
Baseline SHA: <sha>

## Goal and friction story

<the discovery friction story this plan removes, with its measured today-cost>

## Step graph

| Step | Transformation | Target | Depends on | Surfaces (disposition) | Revert cost |
|---|---|---|---|---|---|

## Steps

### Step S1: <transformation>: <target>

- Depends on: none
- Mechanical recipe:
- Equivalence check:

```bash
<golden baseline commands>
```

- Outcomes must equal golden baseline (including pinned failures): yes
- Surfaces touched + disposition:
- Expected complexity delta:
- Revert cost:
- Commit message seed:
- Escalation triggers:

## Parallel-change tracking (MIGRATE surfaces)

| Surface | Expand step | Migrate step(s) | Contract step |
|---|---|---|---|

## Expected total complexity delta

- Files deleted/merged:
- Wrappers removed:
- Call sites simplified:
- Duplication consolidated:
- Interface surface reduced:

## Quarantine compliance

Quarantined items from baseline, each confirmed untouched by every step.

## Alternatives considered

| Alternative (incl. do-nothing) | Why not |
|---|---|

## Open questions

Use `None` for `APPROVED_FOR_REFACTOR`.

## Next command

`/implement-refactor <this artifact path>`
```

## F2 tag rules

Artifact paths in tags and next commands must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs.

- `[REFACTOR-PLAN-READY:<path>]`
- `[REFACTOR-PLAN-NEEDS-DECISION:<path>]`
- `[REFACTOR-PLAN-BLOCKED:<path>]`

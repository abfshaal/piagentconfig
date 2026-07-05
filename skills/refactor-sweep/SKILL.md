---
name: refactor-sweep
description: Quick refactor cleanup after fast AI iteration. Use only when invoked by `/refactor-sweep`; inspects a target or current diff for unnecessary complexity, missed reuse, shallow wrappers, and safe behavior-preserving cleanup, with optional implementation.
---

# Refactor Sweep

Purpose: fast, local cleanup pass after rapid iteration. Find and optionally remove AI-speed cruft without changing product behavior.

## Core principle

Behavior-preserving by default. Refactor means same externally observable behavior with simpler code, better locality, or clearer module depth.

## Matt Pocock-inspired vocabulary

Use these terms consistently:

- **Module**: anything with an interface and implementation: function, class, package, component, slice.
- **Interface**: everything callers must know: types, invariants, error modes, ordering, config, not just signature.
- **Implementation**: code inside the module.
- **Depth**: leverage behind the interface. Deep = simple interface hides meaningful behavior. Shallow = interface nearly as complex as implementation.
- **Seam**: where behavior can be changed without editing in place.
- **Adapter**: concrete implementation at a seam.
- **Leverage**: what callers gain from module depth.
- **Locality**: how concentrated change, bugs, and knowledge are.
- **Deletion test**: if module disappears, does complexity vanish or spread into callers?
- **Two-adapter rule**: one adapter is a hypothetical seam; two adapters means real seam.

## Invocation modes

- Default: inspect + artifact only. No code edits.
- `--implement`: implement safe sweep tasks after artifact.
- `--no-commit`: validate but do not commit.
- `--hitl`: pause for human validation before commit.
- `--diff`: target current uncommitted git diff.
- `--target <path-or-area>`: target specific slice.
- `--from <start-commit> --to <end-commit>`: target committed range `<start-commit>..<end-commit>` and inspect commits one by one.
- `--range <start-commit>..<end-commit>`: same as `--from/--to`.

If no target or flag is clear, prefer current git diff when inside a git repo; otherwise ask one question.

## Fit check

Use sweep when:

- recent changes feel too big/noisy
- local folder/file needs simplification
- cleanup is likely 1-3 small tasks
- behavior should remain unchanged

Escalate to `/refactor-discovery` when:

- architecture-wide candidate search is needed
- more than 3 tasks likely
- module seams/API contracts need redesign
- tests/behavior baseline unclear
- product behavior may change

## Required flow

1. Determine target: diff, commit range, path, symbol, or described area.
2. If inside git, record starting status. Never stage/commit unrelated dirty changes.
3. Ensure `.scratch/` is ignored via `.git/info/exclude` when inside git.
4. If commit-range mode is used:
   - verify both endpoints with `git rev-parse`
   - enumerate commits in order with `git rev-list --reverse <start>..<end>`
   - inspect each commit with targeted `git show --stat --name-status --find-renames <sha>` and relevant hunks
   - validate each commit one by one when a safe validation command is known or discoverable
   - do not checkout/reset the current worktree; if per-commit validation needs checkout, use temporary detached worktrees under a temp directory and remove them after, or mark validation blocked/manual if that is unsafe
   - record per-commit findings and validation separately
5. Inspect target with bounded reads/search.
6. Establish behavior contract:
   - what must stay unchanged
   - current tests/validation
   - visible APIs/interfaces touched
   - compatibility surfaces touched: exports, routes, schemas, config keys, serialized data, CLI flags, events, component props
   - current known failures or bugs to quarantine, not silently fix
7. Find sweep opportunities:
   - unnecessary files/modules/wrappers
   - duplicated logic or concepts
   - shallow modules
   - missed existing patterns
   - broadened scope/nice-to-haves
   - dead code created by recent work
8. Rank tasks:
   - `Safe now`
   - `Needs decision`
   - `Too broad; use refactor-discovery`
9. Write one artifact: `.scratch/agent-workflow/refactor/sweeps/YYYY-MM-DD-<slug>-refactor-sweep.md`.
10. If not `--implement`, stop with `[REFACTOR-SWEEP-READY:<path>]`, `[REFACTOR-SWEEP-NEEDS-DECISION:<path>]`, or `[REFACTOR-SWEEP-BLOCKED:<path>]`.
11. If implementing:
    - implement only `Safe now` tasks
    - use TDD/characterization test when practical
    - validate before and after meaningful changes when possible and record a before/after matrix
    - quarantine existing bugs discovered during cleanup as follow-up unless explicitly approved
    - run focused self-review: behavior, compatibility, deletion, locality, reuse, tests, complexity delta
    - commit each task or one small sweep commit unless `--no-commit`
    - in commit-range mode, apply cleanup to the current worktree only if current `HEAD` is the range end or a descendant and commit isolation is safe; never rewrite historical commits/rebase/squash from this command without explicit runtime approval
    - update same artifact with results
    - final tag: `[REFACTOR-SWEEP-COMPLETE:<path>]`, `[REFACTOR-SWEEP-PARTIAL:<path>]`, or the blocked/decision tag

## Guardrails

- Prefer deletion/consolidation before extraction.
- Do not create a new seam unless two real adapters/variants exist or the plan justifies the seam.
- Do not add dependencies.
- Never use `git add .`; stage only task files/hunks.
- Do not alter public/product behavior without explicit user approval.
- Do not rename or move broad surfaces unless the reason, affected imports/callers, validation, and isolated commit scope are clear.
- Do not refactor untested risky code without characterization or manual validation plan.
- If an existing bug is discovered, do not silently fix it; document it as a follow-up or ask for approval to include it.
- If a new domain term/seam emerges, note whether `CONTEXT.md`/ADR updates are needed; do not make doc changes unless the sweep task approves them.
- In commit-range mode, review and validate commits in chronological order; keep per-commit findings separate from whole-range cleanup recommendations.
- Do not rewrite commit history in refactor sweep. Use follow-up cleanup commits only, unless the user explicitly requests and approves history editing.

## Artifact template

```markdown
# Refactor Sweep: <target>

Date: <date>
Status: READY_FOR_SWEEP | NEEDS_DECISION | BLOCKED | COMPLETE | PARTIAL | NEEDS_HUMAN_VALIDATION
Mode: PLAN_ONLY | IMPLEMENT | IMPLEMENT_NO_COMMIT | HITL
Target: <diff/path/symbol/area/range>
Commit range: <start>..<end or not applicable>

## Refactor intent

## Behavior preservation contract

### Must not change

### Public/interface surfaces

### Compatibility audit

- Exports:
- Routes/API contracts:
- Data/schema/serialized formats:
- Config keys / CLI flags / events:
- Component props/UI contracts:

### Baseline validation

### Known bugs / failing baseline quarantine

## Evidence inspected

| Area | Evidence | Implication |
|---|---|---|

## Commit range review

| Commit | Summary | Files touched | Sweep findings | Validation | Risk |
|---|---|---|---|---|---|

## Per-commit validation evidence

| Commit | Command/check | Exit/result | Output summary | Notes |
|---|---|---:|---|---|

## Sweep findings

| Finding | Evidence | Refactor concept | Recommendation | Risk |
|---|---|---|---|---|

## Tiny sweep plan

| Task | Goal | Files/hunks | Validation | Commit message seed | Regression risk | Applies to commit/range |
|---|---|---|---|---|---|---|

## Needs decision / too broad

## Implementation result

Omit this whole section in `PLAN_ONLY` mode; fill it only when implementing.

### Tasks completed

### Files changed

### Complexity delta

- Deleted/merged:
- Wrappers removed:
- Call sites simplified:
- Duplication reduced:
- Interface surface changed:
- Locality/leverage outcome:

### Before/after validation evidence

| Command/check | Before | After | Summary |
|---|---:|---:|---|

### Validation evidence

| Command/check | Exit/result | Summary |
|---|---:|---|

### Commits

| Task | Commit SHA | Message |
|---|---|---|

## Remaining work
```

## Final tags

Artifact paths in tags must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs.

- `[REFACTOR-SWEEP-READY:<path>]`
- `[REFACTOR-SWEEP-NEEDS-DECISION:<path>]`
- `[REFACTOR-SWEEP-BLOCKED:<path>]`
- `[REFACTOR-SWEEP-COMPLETE:<path>]`
- `[REFACTOR-SWEEP-PARTIAL:<path>]`

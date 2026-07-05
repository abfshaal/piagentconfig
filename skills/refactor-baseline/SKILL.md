---
name: refactor-baseline
description: Heavy refactor workflow stage 2 — characterization baseline. Use only when invoked by `/refactor-baseline`; pins current behavior with characterization tests, freezes/flexes compatibility surfaces with the user, and records the golden baseline the rest of the pipeline validates against.
---

# Refactor Baseline (Characterization)

Purpose: make current behavior observable and pinned before anyone changes it.

In a refactor, current behavior IS the spec. This stage replaces feature-flow `/spec` + `/design`. There is nothing to specify and no alternatives to design yet — there is behavior to capture and tolerances to agree.

## Rules

- Command-only. Do not trigger from ordinary requests.
- Source gate: continue only when the discovery artifact status is `READY_FOR_BASELINE` (or clearly equivalent) and a candidate is selected. Otherwise write a `Status: BLOCKED` baseline artifact naming what must be resolved, recommend rerunning `/refactor-discovery`, and stop.
- The ONLY production-code edits allowed in this stage are none. Test-only edits are allowed: characterization tests may be added and committed (test files only, one commit, message prefixed `baseline:`). If a characterization test cannot be written without touching production code (no seam to observe through), record that as a planning constraint — the first plan step must create the seam, and that behavior stays `UNOBSERVED` until then.
- Characterization tests pin behavior AS IT IS, including oddities. If current behavior looks buggy: quarantine-log it, pin it anyway, and ask the user only whether the bug's fix should be a separate follow-up — never fix it here.
- Every user question is a tolerance question. One question per `ask_user_question` call.
- Write exactly one artifact under `.scratch/agent-workflow/refactor/baselines/`.
- Ensure `.scratch/` is ignored via `.git/info/exclude` when inside git.
- Stop after artifact summary, one F2 tag, and next command.

## Compatibility surface inventory

For the selected candidate, inventory every surface an outside party could depend on:

- exported functions/types and their signatures
- routes / API contracts / wire formats
- DB schemas, serialized data, file formats
- config keys, CLI flags, env vars
- event names, log lines consumed by tooling, error messages and codes
- import paths other packages/teams use
- component props / UI contracts
- performance characteristics callers may rely on (only when plausible)

## Freeze/flex decisions (the user questions)

Each inventoried surface gets a disposition the user confirms:

- `FROZEN` — must be byte/contract-identical after the refactor.
- `FLEX` — may change; state the allowed change (e.g. "error message text may change, error code may not").
- `MIGRATE` — will change via parallel-change (expand/migrate/contract) in the plan; old form supported until contract step.

Ask only where the answer is not obvious from code/tests/docs. Obvious internals default to FLEX; obvious public API defaults to FROZEN — state defaults in the artifact and ask about the genuinely ambiguous ones.

## Golden baseline

Record the evidence future stages compare against:

- exact validation commands (test suite, lint, build, targeted scripts) with current exit codes and result summaries — including currently-failing items, listed in the quarantine register with their exact current failure output
- baseline git SHA
- perf numbers only when a surface is FROZEN on performance
- coverage map: for each behavior the refactor will touch, which check observes it

**Gate: no `READY_FOR_PLAN` while any touched behavior is `UNOBSERVED`** unless it is explicitly listed as a seam-creation constraint for the plan or the user accepts the risk in the risk register.

## Required flow

1. Validate discovery artifact path + selected candidate. If missing/ambiguous, ask one question.
2. Read discovery artifact fully. Ensure `.scratch/` exclude.
3. Build the compatibility surface inventory from code, not memory.
4. Propose freeze/flex/migrate dispositions; ask the user about ambiguous ones, one at a time.
5. Map coverage: behavior to be touched vs the check that observes it. List gaps.
6. Write characterization tests for gaps (test files only). Run them green against current behavior. Commit test-only changes once: `baseline: characterization tests for <candidate>`.
7. Run the full validation command set; record exact outcomes (including pre-existing failures → quarantine register).
8. Record baseline SHA and golden outcomes in the artifact.
9. Status: `READY_FOR_PLAN` when the gate passes and all tolerance questions are resolved; `NEEDS_DECISION` when tolerance questions remain; `BLOCKED` when behavior cannot be made observable and the user has not accepted that risk.
10. Write artifact: `.scratch/agent-workflow/refactor/baselines/YYYY-MM-DD-<slug>-refactor-baseline.md`.
11. Final response: artifact path, surface dispositions summary, coverage gaps closed/remaining, exactly one F2 tag, next command `/refactor-plan <artifact-path>` only when ready. Stop.

## Artifact template

```markdown
# Refactor Baseline: <candidate>

Date: <date>
Status: READY_FOR_PLAN | NEEDS_DECISION | BLOCKED
Source discovery: <path>
Selected candidate: <id/title>
Baseline SHA: <sha>

## Compatibility surfaces

| Surface | Kind | Disposition | Allowed change (FLEX/MIGRATE) | Decided by |
|---|---|---|---|---|

## Behavior coverage map

| Behavior to be touched | Observed by (test/command) | Status (OBSERVED / ADDED / UNOBSERVED) |
|---|---|---|

## Characterization tests added

| Test | Pins | Commit |
|---|---|---|

## Golden baseline

| Command | Exit code | Result summary |
|---|---:|---|

## Known bugs / failing baseline quarantine

| Item | Exact current failure | Pinned by | Follow-up disposition (user) |
|---|---|---|---|

## Seam-creation constraints for the plan

## Risk acceptance register

| Risk | Impact | Disposition | User acceptance / mitigation evidence |
|---|---|---|---|

## User decisions

## Readiness

- Ready: yes/no
- Blockers:
- Recommended next command: `/refactor-plan <this artifact path>`
```

## F2 tag rules

Artifact paths in tags and next commands must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs.

- `[REFACTOR-BASELINE-READY:<path>]`
- `[REFACTOR-BASELINE-NEEDS-DECISION:<path>]`
- `[REFACTOR-BASELINE-BLOCKED:<path>]`

---
name: task-planning
description: Task planning for the staged workflow. Use only when invoked by `/plan` or when explicitly asked to work on that staged command.
---

# Task Planning

Purpose: turn approved implementation design into reviewed vertical-slice tasks.

Non-negotiable gate: `task-planner` drafts the plan, then fresh `plan-reviewer` reviews it before finalization. A plan with `BLOCKED` or `NEEDS_DECISION` is not final and cannot be used for `/implement-plan`.

## Rules

- Command-only. Do not trigger from ordinary requests unless `/plan` is invoked.
- Also load and follow the `plan-reviewing` skill if available when running `plan-reviewer`.
- Read discovery/spec/design artifacts.
- Source artifact gate: continue only when design status is `READY_FOR_PLAN` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing approved schema/API/architecture decisions, or unclear, write a `Status: BLOCKED` plan artifact explaining what must be resolved, recommend rerunning `/design <spec-artifact-path>` or fixing that artifact, and stop. Do not draft tasks or recommend `/implement-plan`.
- Use `task-planner` to draft the plan. `task-planner` has `completionGuard: false`, so describe the task naturally; no special wording is needed.
- Prefer `artifacts: false` for `task-planner` so the parent receives the draft inline; parent writes the final plan artifact after review.
- Always run `plan-reviewer` with fresh context against the draft plan before finalizing. Mandatory, not optional. Review-only.
- Parent synthesizes review findings and applies accepted fixes.
- Use `ask_user_question` for every planning-level unresolved decision, material risk acceptance, or question surfaced by `task-planner`/`plan-reviewer`. Ask exactly one question per tool call.
- Do not approve a plan with any open questions. Resolve them with the user, send them upstream to design/spec/discovery as `NEEDS_DECISION`, or block.
- Every material risk in the plan must have a disposition: accepted by the user, mitigated by a task/constraint/validation step, deferred as a non-goal, or blocking.
- Apply accepted review fixes.
- Re-run `plan-reviewer` if fixes changed task structure, dependencies, validation, scope, risk dispositions, or escalation rules.
- Do not implement.
- Write one final artifact under `.scratch/agent-workflow/plans/` with `Plan review status`, no open questions, and all material risks accepted/mitigated/deferred/blocking.
- Include exactly one F2-compatible artifact tag on its own line in the final response.
- Recommend `/implement-plan` only when status is `APPROVED_FOR_IMPLEMENTATION`.
- Stop after artifact summary and next command/blocker.

## task-planner prompt

Use this shape when launching `task-planner`:

```markdown
Draft an implementation task plan. Read these artifacts fully:
- Design: <path>
- Spec: <path>
- Discovery: <path>

Return only a markdown draft task plan in your required output format. Status DRAFT only if no open questions remain. Include AFK/HITL validation mode, goal, acceptance criteria covered, reuse-first files/modules, likely files, baseline validation/reproduction, dependencies/blockers, non-goals, TDD RED/GREEN, validation command, expected validation output, review scope, commit scope, commit message seed, documentation/release impact, non-functional validation if relevant, risk register with dispositions, resolved question log, and escalation triggers. Respect approved constraints from the source artifacts. If any unresolved question or unaccepted material risk exists, return NEEDS_DECISION/BLOCKED instead of DRAFT.
```

## Task quality bar

Every task needs:

- AFK/HITL validation mode label:
  - `AFK`: agent can implement, review, validate, commit, and continue without a human checkpoint.
  - `HITL`: agent should still implement first, then pause after reviews and automated validation for human/manual validation before commit/continue.
  - Do not use `HITL` to mean “do not start implementation.” If work cannot start without a decision/context, mark `BLOCKED` or `NEEDS_DECISION` instead.
- goal
- acceptance criteria covered
- reuse-first files/modules
- likely files touched
- review scope: files/artifacts/evidence a reviewer should inspect, and any known pre-existing dirty areas to ignore
- commit scope: files/hunks expected to belong in that task commit, plus a commit message seed
- dependencies/blockers
- explicit non-goals
- baseline validation/reproduction step when relevant, especially bugfixes and high-risk changes
- TDD RED/GREEN steps
- validation command and expected output
- documentation/release impact, or marked not applicable
- non-functional validation when relevant
- escalation triggers
- no open questions for an approved plan
- material risks have explicit accepted/mitigated/deferred/blocking dispositions

Task size philosophy:

- Prefer bite-sized vertical slices over broad task batches.
- A fresh implementer should be able to complete one task without choosing from the wider plan.
- A fresh reviewer should be able to verify one task from the task text, linked artifacts, changed files, working-tree/commit diff, and validation evidence without broad repo rediscovery.
- Each task should be independently committable after successful review/validation.
- If a task would require broad exploration or cannot be isolated into its own commit, split it or mark `BLOCKED`/`NEEDS_DECISION` with the missing decision/context. Use `HITL` only for tasks that can be agent-executed but require a human validation checkpoint after the agent work.

## Plan is not final when

- `plan-reviewer` returns `BLOCKED`
- `plan-reviewer` returns `NEEDS_DECISION`
- any task requires fresh implementer guessing
- any task requires reviewer repo-wide rediscovery instead of a scoped review
- any task cannot be isolated into a task-specific commit
- any hidden product/schema/API/architecture decision remains
- any open question remains
- any material risk lacks an accepted/mitigated/deferred/blocking disposition

## Required flow

1. Validate that the design artifact path exists. If missing or ambiguous, ask one question for the correct path.
2. Read the design fully. Read linked spec and discovery artifacts.
3. Source artifact gate: continue only if design status is `READY_FOR_PLAN` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing approved schema/API/architecture decisions, or unclear, write a `Status: BLOCKED` plan artifact explaining what must be resolved, recommend rerunning `/design <spec-artifact-path>` or fixing that artifact, and stop. Do not draft tasks or recommend `/implement-plan`.
4. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
5. Launch `task-planner` with fresh context. Give it artifact paths and ask for draft task output only. `task-planner` has `completionGuard: false`; describe the planning task naturally. Prefer `artifacts: false` so the parent receives the draft inline; parent writes the final artifact after review.
6. Launch `plan-reviewer` with fresh context. Give it the artifact paths and draft plan text. Review-only.
7. If draft/review returns `NEEDS_DECISION`, ask the user one question at a time only if the decision or material risk acceptance belongs in planning. If it belongs in design/spec/discovery, write a `Status: NEEDS_DECISION` plan artifact explaining the upstream blocker and recommend `/design <spec-artifact-path>`, `/spec <discovery-artifact-path>`, or `/discovery-alignment <feature idea>`. Do not recommend `/implement-plan`.
8. If review returns `BLOCKED`, fix the draft if the fix is purely planning-level. If not fixable without upstream changes, write a `Status: BLOCKED` plan artifact explaining the blocker. Do not recommend `/implement-plan`.
9. If fixes changed task structure/dependencies/validation/scope/risk dispositions/escalation, run `plan-reviewer` again. A plan is approvable only when there are no open questions and no material risks lacking disposition.
10. Write artifact path: `.scratch/agent-workflow/plans/YYYY-MM-DD-<slug>-plan.md`.
11. Final response: artifact path, plan review status, task count if approved, blockers if not approved, and exactly one F2 artifact tag. State next command as `/implement-plan <artifact-path>` only when status is `APPROVED_FOR_IMPLEMENTATION`; otherwise state the upstream command needed. Then stop.

## F2 artifact tag rules

- `<artifact-path>` must resolve from the current Pi session cwd. If the artifact is written in a repo below or outside that cwd, use an absolute path or session-cwd-relative path in the tag and next command.
- If artifact status is `APPROVED_FOR_IMPLEMENTATION`, include `[PLAN-READY:<artifact-path>]` on its own line.
- If artifact status is `NEEDS_DECISION`, include `[PLAN-NEEDS-DECISION:<artifact-path>]` on its own line.
- If artifact status is `BLOCKED`, include `[PLAN-BLOCKED:<artifact-path>]` on its own line.

## Artifact template

````markdown
# Implementation Plan: <feature>

Date: <date>
Status: APPROVED_FOR_IMPLEMENTATION | NEEDS_DECISION | BLOCKED
Source design: <path>
Source spec: <path>
Source discovery: <path>

## Plan review status

- Reviewer status: PASS | PASS_WITH_NOTES | BLOCKED | NEEDS_DECISION
- Review run(s): <summary>
- Accepted fixes applied:
- Deferred notes:
- Remaining blockers:

## Implementation rules

- One writer at a time.
- TDD when tests are possible.
- Reuse first; no new abstractions/dependencies/files unless task approves them.
- Stop on unapproved product/schema/API/architecture/scope decisions.
- Stop on new open questions or material risks not covered by the plan risk register.
- Destructive git operations require runtime approval.

## Risk acceptance register

| Risk | Impact | Disposition | User acceptance / mitigation evidence |
|---|---|---|---|

## Resolved questions

| Question | Answer | Source |
|---|---|---|

## Tasks

### Task 1: <vertical slice>

- Status: TODO
- AFK/HITL: AFK | HITL
- Goal:
- Acceptance criteria covered:
- Reuse first:
- Likely files:
- Dependencies/blockers:
- Non-goals:
- Baseline validation / reproduction:
- TDD RED:
- TDD GREEN:
- Validation command:

```bash
<command>
```

- Expected validation output:
- Review scope:
- Commit scope:
- Commit message seed:
- Documentation / release notes impact:
- Non-functional validation:
- Escalation triggers:

## Final validation contract

```bash
<command>
```

## Out of scope

## Open questions

Use `None` for `APPROVED_FOR_IMPLEMENTATION`. Any non-None value means status must be `NEEDS_DECISION` or `BLOCKED`.

## Notes for implementer
````

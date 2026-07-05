---
name: implementation-loop
description: Parent-orchestrated implementation loop for the staged workflow. Use only when invoked by `/implement-plan` or explicitly asked to work on that staged command.
---

# Implementation Loop

Purpose: implement an approved plan with one writer, TDD, fresh reviewers, per-task commits, and evidence.

## Rules

- Command-only. Do not trigger from ordinary requests unless `/implement-plan` is invoked.
- Also load and follow the `reuse-first-review` skill if available for reuse review scope.
- Precondition: start only from a plan artifact with `Status: APPROVED_FOR_IMPLEMENTATION`, `Plan review status` with no blockers/unresolved decisions (passing plan review), no open questions, and all material risks already accepted/mitigated/deferred/blocking. If not, stop and tell the user to run `/plan <design-artifact-path>` or resolve the blocker.
- Parent owns orchestration.
- Use exactly one writer at a time: `plan-implementer` for the current task/subtask only, `fix-worker` or `plan-implementer` for accepted fixes.
- Execute approved tasks/subtasks one at a time, in plan order.
- Children do not run subagents or ask the user.
- Parent must expose progress when possible: keep `stage_progress` current when available with the full ordered task/subtask queue, current item, writer/review/fix/validation/commit phase, done/blocked state.
- Parent owns git staging/commits. Child agents never stage or commit.
- Commit each task after implementation, fixes, reviews, and validation succeed. Do not commit partial or blocked work.
- Use TDD when tests are possible.
- Reuse existing modules/patterns first.
- Parent synthesizes reviewer findings and chooses fixes worth doing now.
- Stop on unapproved product/schema/API/architecture/scope decisions, new open questions, or newly discovered material risks not already accepted/mitigated/deferred in the plan.
- Use `ask_user_question` when a new material risk or decision appears during implementation. Ask exactly one question per tool call.
- HITL is a post-implementation validation checkpoint, not permission to skip or block coding work.
- For a task labeled `AFK/HITL: HITL`, run the agent-executable implementation, reviews, and automated validation first; then pause for human validation before marking done, committing, or continuing.
- Write one implementation report under `.scratch/agent-workflow/reports/`.
- Include `[IMPLEMENTATION-REPORT:<report-path>]` on its own line in the final response so F2 opens the report.
- Stop after report summary and next command.

## Reviewer scope and ownership

- `spec-reviewer` runs in its Mode B (implementation compliance) during this loop.
- Lane ownership: `spec-reviewer` owns acceptance-criteria/non-goals/scope-creep verdicts; `code-quality-reviewer` owns correctness/maintainability; `reuse-reviewer` owns duplication/missed-reuse/overbuilding.
- Parent should ignore out-of-lane severities from any reviewer.

## Required flow

1. Validate and read the plan. Read linked design/spec/discovery artifacts. If the approved plan has non-None open questions or material risks without accepted/mitigated/deferred/blocking disposition, write a blocked report and stop before launching writers.
2. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
3. If inside a git repo, real per-task commits are required. Capture starting status with `git status --short` and prefer a clean worktree. If pre-existing changes exist, do not stage or commit them. If a task must touch a pre-existing dirty path or the task diff cannot be isolated safely, mark `BLOCKED` and ask the user to clean/stash/commit or explicitly approve mixing changes.
4. Extract the approved task queue in exact plan order. Include explicit subtasks/checklist items when the plan has them; otherwise use top-level tasks. Do not reorder for convenience; no reordering unless a dependency/blocker requires a stop. Do not skip or block a task merely because it is labeled `HITL`; that label controls the validation pause after agent-executable work.
5. If the `stage_progress` tool is available, call it immediately with `action: "start"`, the plan path, feature name, and the ordered queue. Keep it updated before and after every writer, review, fix, validation, commit, blocker, and completion.
6. Identify the next pending approved task/subtask. Continue sequentially through all approved `AFK` tasks by default. Do not stop merely because one task ended or the next task is larger. Stop only when a HITL/manual checkpoint, blocker, failed validation, failed/unsafe commit isolation, context/time budget exhaustion, or unapproved decision/risk appears.
7. Before launching work, call `stage_progress` with `action: "set_task"`, `status: "running"`, and the current task id/title.
8. If inside git, record `BASE_SHA=$(git rev-parse HEAD)` and `PRE_TASK_STATUS=$(git status --short)` before the writer. If the task specifies baseline validation/reproduction, run or verify it before the writer when practical and record evidence. Launch one fresh `plan-implementer` with only the exact current task/subtask text and linked artifact paths, for tasks with implementation/fix/cleanup work. Never pass the whole plan as work to be chosen by the subagent. For validation-only tasks, the parent may run the specified validation directly or launch `plan-implementer` only if the task authorizes cleanup/fixes.
9. Verify implementer evidence directly where important. Do not trust summary alone.
10. Mark the current task `reviewing`. Run review gates sequentially by default with scoped prompts: current task/subtask, exact changed files, working-tree diff against `BASE_SHA` (or committed range when already committed), linked artifacts, parent validation evidence, and any known pre-existing dirty hunks. Do not ask reviewers to rediscover the whole repo.
   1. Run `spec-reviewer` first, in its Mode B (implementation compliance). If it finds must-fix spec gaps, mark `fixing`, run one `fix-worker`, then re-run `spec-reviewer` before any other reviewer.
   2. Run `code-quality-reviewer`, `reuse-reviewer`, and `validation-reviewer` only after spec compliance is acceptable. Parallelize these only when the task slice is small and scopes are exact; otherwise run sequentially.
11. Synthesize findings into: must-fix now, optional/defer, reject with reason. Apply reviewer lane ownership and ignore out-of-lane severities. If a reviewer says the slice is too broad, context is missing, an open question remains, or a material risk lacks disposition, treat that as a plan/task-size blocker or ask the user with `ask_user_question`; do not let the reviewer roam repo-wide.
12. If must-fix findings exist, mark the current task `fixing`, launch one `fix-worker` with only accepted fixes, then re-run only relevant reviewers for meaningful fixes.
13. Run task validation commands and record exit codes/output as validation evidence.
14. If the task label is `HITL` or validation evidence says `NEEDS_MANUAL_VALIDATION`, mark the item `needs_human_validation` and pause after all agent-executable work is complete. Provide exact manual validation steps, expected results, changed files, and current validation evidence. Use `ask_user_question` when available to ask whether manual validation passed. If the user reports failure, mark `fixing` and run one targeted fix loop before re-review/re-validation. If the user confirms success, continue to commit. If no live answer is available, write the implementation report with status `NEEDS_HUMAN_VALIDATION` and stop; do not call this blocked.
15. After implementation, fixes, reviews, and validation succeed, mark the task `committing` and commit the task before marking it done:
   - Stage only files changed for the current task/fixes. Never use `git add .`.
   - Exclude `.scratch/`, reports, subagent artifacts, and pre-existing unrelated changes.
   - Verify staged content with `git diff --cached --stat`, `git diff --cached --check`, and targeted `git diff --cached -- <task-files>` as needed.
   - Commit with a task-specific message, e.g. `Task <id>: <short task title>`, and a body listing source plan plus validation commands.
   - Record `TASK_COMMIT_SHA=$(git rev-parse HEAD)` in progress/report.
   - If there are no task changes to commit, do not create an empty commit unless the plan explicitly calls for a no-op/validation-only task; record why.
   - If commit isolation cannot be guaranteed, mark `blocked`.
16. Mark the task `done` only after implementation, review/fix, required automated/manual validation evidence, and the task commit succeed. Mark `needs_human_validation` when a HITL/manual checkpoint stops progress after automated work. Mark `blocked` when a blocker/unapproved decision stops progress, validation fails, commit fails, or commit isolation cannot be guaranteed — never on the HITL label itself.
17. Continue or stop: after an `AFK` task is committed, immediately continue to the next approved task. Stop when all tasks complete, a HITL/manual checkpoint is reached after agent-executable work, a blocker appears, validation cannot run, commit fails, context/time budget is exhausted, or remaining work needs approval. For HITL, continue only after human validation passes; otherwise stop with a `NEEDS_HUMAN_VALIDATION` report.
18. Write report path: `.scratch/agent-workflow/reports/YYYY-MM-DD-<slug>-implementation-report.md`.
19. Before final response, call `stage_progress` with `action: "finish"` if complete/partial, or keep blocked state visible if blocked.
20. Final response: report path, tasks completed/blocked, commit SHAs, validation evidence, `[IMPLEMENTATION-REPORT:<report-path>]` on its own line, and next command: `/finish-work <plan-or-spec-artifact-path>`. The report path in the tag and any next-command artifact path must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs from session cwd. Then stop.

## Finish criteria

- acceptance criteria covered or remaining work documented
- validation evidence recorded, including human validation confirmation for HITL tasks
- no must-fix reviewer blockers
- task commit SHAs recorded for completed tasks
- non-goals respected

## Report template

```markdown
# Implementation Report: <feature>

Date: <date>
Status: COMPLETE | PARTIAL | BLOCKED | NEEDS_CONTEXT | NEEDS_HUMAN_VALIDATION
Source plan: <path>
Source design: <path>
Source spec: <path>

## Tasks attempted

| Task | Status | Commit | Writer status | Validation |
|---|---|---|---|---|

## Files changed

## TDD evidence

## Review summary

### Spec reviewer

### Code quality reviewer

### Reuse reviewer

### Validation reviewer

## Fixes applied

## Commits

| Task | Commit SHA | Message |
|---|---|---|

## Validation evidence

| Command | Exit code | Output summary |
|---|---:|---|

## Blockers / decisions needed

## New risks / open questions encountered

| Item | Status | User acceptance / mitigation evidence |
|---|---|---|

## Remaining tasks

## Next command

`/finish-work <plan-or-spec-artifact-path>`
```

---
name: compressed-alignment
description: Compressed staged workflow for quick bugfixes or small features. Use only when invoked by `/compressed-alignment` or `/compressed alignment`; combines micro-discovery, mini-spec, inline design, tiny plan, optional implementation, validation, and optional commit into one artifact.
---

# Compressed Alignment

Purpose: handle small fixes/features quickly while preserving staged workflow rationale: codebase-grounded discovery, alignment, spec, design, plan, validation, and commit discipline.

## Invocation

- Command-only. Use only when `/compressed-alignment` or alias `/compressed alignment` is invoked.
- Alias handling for `/compressed`: if the first argument is `alignment`, treat the remaining arguments as the request/artifact/flags; otherwise still run compressed alignment using all arguments as the request/artifact/flags. Flags pass through unchanged.
- Use the canonical command name `/compressed-alignment` in summaries and recommendations.
- Input may be:
  - a new small bug/feature request
  - an existing compressed artifact path plus `--implement`
- Supported flags:
  - `--plan-only`: produce artifact, do not edit code.
  - `--implement`: implement after compressed artifact is ready.
  - `--no-commit`: validate but do not commit.
  - `--hitl`: pause for human/manual validation before commit.

## Fit check

Fit-check first: run this check before committing to the compressed flow. If the work is too broad/risky, write a blocked/decision artifact and recommend the full staged workflow.

Use compressed flow only when all are true:

- local or narrow behavior change
- likely 1-3 small task slices
- no broad architecture change
- no hard-to-reverse decision
- validation path is known or quickly discoverable

Escalate to full staged workflow when any are true:

- more than 3 task slices
- product behavior is unclear after bounded discovery
- database schema/migration/backfill/rollback needed
- public API contract changes materially
- permissions/privacy/security changes materially
- large UX decision needed
- rollback is costly or unclear
- commit isolation cannot be guaranteed

If escalation is needed, write the compressed artifact with `Status: BLOCKED` or `Status: NEEDS_DECISION` and recommend `/discovery-alignment <request>`.

## Budgets

Default parent budget before artifact:

- max 5 shell commands
- max 5 files opened
- max 120 lines per file
- stop once enough evidence exists

Implementation budget:

- prefer parent-direct edits for tiny changes
- use one writer only if a child is useful
- no broad repo roaming
- do not launch scouts unless the slice is still narrow and the parent budget is insufficient

## Clarification policy

- Evidence-first does not mean preference-inference. Use code/artifact evidence to discover current behavior, constraints, existing patterns, and available validation. Do not use code evidence to guess user intent or tradeoff preferences.
- Before writing the plan, run a decision gate:
  - If only one low-risk implementation path fits the request and repo constraints, proceed without asking.
  - If multiple reasonable paths differ in dependency, architecture, public interface, data shape, persistence model, operational risk, UX/product behavior, validation burden, reversibility, or future-growth direction, ask before choosing.
- Ask as many clarification questions as needed to avoid locking the wrong plan, but keep them material and scoped to compressed-flow fit. Each `ask_user_question` call must contain exactly one question; use multiple calls for multiple questions.
- Prefer asking high-leverage questions early over burying assumptions in non-goals or alternatives.
- Do not ask for commit message wording by default. Generate commit message seeds from task goals. Ask only if commit wording/policy is itself a user preference or repo-required decision.

## Required flow

1. Parse request and flags. If no request/artifact path was provided, ask one question for the target bug/feature.
2. If inside a git repo, ensure `.scratch/` is in `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
3. Do micro-discovery within the default parent budget (max 5 shell commands, max 5 files opened, max 120 lines per file), and apply the fit check; if escalation is needed, write the artifact with `Status: BLOCKED` or `Status: NEEDS_DECISION` and recommend `/discovery-alignment <request>`. Micro-discovery:
   - identify relevant files/tests/docs
   - inspect existing pattern to reuse
   - confirm current behavior or likely bug seam
   - use `ask_user_question` for code/artifact-unanswerable alignment clarifications and material tradeoffs that affect intent, scope, design direction, risk, validation, reversibility, or future growth
4. Do mini-spec:
   - exact intended behavior
   - 1-5 acceptance criteria
   - explicit non-goals
   - validation command/manual check
5. Do inline design:
   - simplest reuse-first approach
   - alternatives skipped with reason
   - risks and rollback notes
6. Do tiny plan:
   - 1-3 independently verifiable tasks max. If more are needed, block and recommend `/discovery-alignment <request>`.
   - expected files/hunks per task
   - validation per task
   - commit message seed per task, generated from the task goal unless commit wording/policy needs user clarification
7. Write one artifact under `.scratch/agent-workflow/compressed/YYYY-MM-DD-<slug>-compressed-alignment.md`.
8. If status is not `READY_FOR_IMPLEMENTATION`, stop with one compressed artifact tag.
9. If `--plan-only` is present, stop with `[COMPRESSED-READY:<path>]` and mention how to implement.
10. If no implementation flag is present, implement only when the request clearly asks to fix/change/implement now; otherwise stop with `[COMPRESSED-READY:<path>]` after the ready artifact.
11. If implementing:
    - capture `BASE_SHA=$(git rev-parse HEAD)` and `PRE_TASK_STATUS=$(git status --short)` when git is available
    - avoid touching pre-existing dirty hunks; block if isolation is unsafe
    - use TDD when practical
    - reuse existing modules/patterns first
    - edit only files required by the tiny plan
    - validate with documented commands/manual evidence
    - do a focused self-review against mini-spec, reuse, code quality, and validation
    - run fresh reviewers only when risk, ambiguity, or non-trivial diff justifies it
12. If `--hitl` or manual validation is required, pause after automated validation. Ask whether manual validation passed. Do not commit until pass.
13. Commit strategy:
    - if inside git and not `--no-commit`, commit after each task or once for a single tiny task
    - parent stages only task files/hunks; never `git add .`
    - verify staged diff before commit
    - do not commit `.scratch/`, reports, subagent artifacts, or unrelated dirty changes
    - do not commit partial/blocked work
    - record commit SHA(s)
14. Update the same compressed artifact with implementation result, validation evidence, changed files, and commits. Do not create a second durable workflow artifact.
15. Final response includes artifact path, status, validation, commits, and exactly one compressed artifact tag.

## Artifact statuses

- `READY_FOR_IMPLEMENTATION`: compressed artifact ready; no code changes required yet.
- `NEEDS_DECISION`: user decision needed before plan or implementation.
- `BLOCKED`: compressed workflow not safe/applicable.
- `COMPLETE`: implementation, validation, and required commits complete.
- `PARTIAL`: some work done but remaining task/blocker exists.
- `NEEDS_HUMAN_VALIDATION`: automated work done; human/manual validation required before commit/finish.

## Artifact tags

Use exactly one tag in final response:

- `[COMPRESSED-READY:<path>]`
- `[COMPRESSED-NEEDS-DECISION:<path>]`
- `[COMPRESSED-BLOCKED:<path>]`
- `[COMPRESSED-COMPLETE:<path>]`
- `[COMPRESSED-PARTIAL:<path>]`
- `[COMPRESSED-REPORT:<path>]` only when a generic report label is clearer

The tag path must resolve from the current Pi session cwd. If artifact is outside cwd or in a repo below cwd, use absolute path or session-cwd-relative path.

## Artifact template

```markdown
# Compressed Alignment: <title>

Date: <date>
Status: READY_FOR_IMPLEMENTATION | NEEDS_DECISION | BLOCKED | COMPLETE | PARTIAL | NEEDS_HUMAN_VALIDATION
Mode: PLAN_ONLY | IMPLEMENT | IMPLEMENT_NO_COMMIT | HITL
Request: <original request>

## Intent

## Micro-discovery

### Files/modules inspected

### Code evidence

| Question | Evidence | Decision/implication |
|---|---|---|

## Reuse target

## Mini-spec

### Acceptance criteria

### Non-goals

## Inline design

### Selected approach

### Alternatives skipped

### Risks / rollback

## Tiny task plan

| Task | Goal | Files/hunks | Validation | Commit message seed |
|---|---|---|---|---|

## Validation contract

## Decisions needed

## Implementation result

### Tasks completed

### Files changed

### TDD evidence

### Review evidence

### Validation evidence

| Command/check | Exit code/result | Output summary |
|---|---:|---|

### Commits

| Task | Commit SHA | Message |
|---|---|---|

## Remaining work / blockers
```

## Final response shape

- Artifact: `<path>`
- Status: `<status>`
- Validation: `<commands/checks>`
- Commits: `<sha or none>`
- Next: `<none or recommended command>`

Then one tag line.

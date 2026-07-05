---
name: implementation-design
description: Implementation design for the staged workflow. Use only when invoked by `/design` or when explicitly asked to work on that staged command.
---

# Implementation Design

Purpose: choose implementation approach after spec approval and before task planning.

## Rules

- Command-only. Do not trigger from ordinary requests unless `/design` is invoked.
- Read approved spec and linked discovery first.
- Source artifact gate: continue only when spec status is `READY_FOR_DESIGN` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing acceptance criteria, missing validation contract, or unclear, write a `Status: BLOCKED` design artifact explaining what must be resolved, recommend rerunning `/spec <discovery-artifact-path>` or fixing that artifact, and stop. Do not recommend `/plan`.
- Inspect relevant existing architecture, data, API, UI, migration, and test patterns. Do not scan the whole repo.
- Prefer reuse and local seams over new abstractions; avoid speculative abstractions.
- Consider at least two viable approaches when architecture/data/API/UI choices are material.
- Ask approval for hard-to-reverse or expensive choices and material implementation risks.
- Use `ask_user_question` for every unresolved user decision, material risk acceptance, and code/artifact-unanswerable question. Ask exactly one question per tool call.
- Before marking `READY_FOR_PLAN`, every material risk must be accepted by the user, mitigated by an explicit design constraint/task validation, deferred as a non-goal, or blocking.
- Never leave open questions in a ready design. If a question could affect product behavior, schema/data, API, permissions/privacy/security, architecture, UX, validation, rollout, reversibility, scope, or non-goals, ask it or mark `NEEDS_DECISION`/`BLOCKED`.
- Write one artifact under `.scratch/agent-workflow/designs/` with status `READY_FOR_PLAN`, `NEEDS_DECISION`, or `BLOCKED`.
- Include exactly one F2-compatible artifact tag on its own line in the final response.
- Stop after artifact summary and next command/blocker.

## Required approval and risk-acceptance points

Ask before finalizing:

- database schema, migration, backfill, rollback
- API contract changes
- permissions/privacy/security changes
- broad architecture/module boundaries
- irreversible or costly rollout decisions

## Design checks

- Deep module check: does interface hide real complexity?
- Deletion test: what disappears if feature is removed?
- Reuse check: what existing module/pattern is used?
- Scope check: what is explicitly not being built?

## Required flow

1. Validate that the spec artifact path exists. If missing or ambiguous, ask one question for the correct path.
2. Read the spec fully. Read linked discovery artifact if present.
3. Source artifact gate: continue only if spec status is `READY_FOR_DESIGN` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing acceptance criteria, missing validation contract, or unclear, write a `Status: BLOCKED` design artifact explaining what must be resolved, recommend rerunning `/spec <discovery-artifact-path>` or fixing that artifact, and stop. Do not recommend `/plan`.
4. Inspect relevant existing implementation patterns. Do not scan the whole repo.
5. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
6. Consider at least two viable approaches when architecture/data/API/UI choices are material.
7. For database/schema/migration work, ask approval before finalizing. Include proposed tables/columns/indexes/migrations/backfill/rollback, alternatives, risks, and recommendation.
8. Ask user questions for unresolved product/schema/API/architecture/validation/rollout/reversibility choices and material risk acceptance. One question per `ask_user_question` call. Every material risk must be accepted by the user, mitigated by an explicit design constraint/task validation, deferred as a non-goal, or blocking before `READY_FOR_PLAN`.
9. If design-stage questions reveal a spec-level decision, write a `Status: NEEDS_DECISION` or `Status: BLOCKED` design artifact explaining the upstream spec issue, then stop and tell the user to update spec before continuing.
10. Write artifact path: `.scratch/agent-workflow/designs/YYYY-MM-DD-<slug>-design.md`.
11. Final response: artifact path, selected approach, decisions approved, risk dispositions, blockers/open questions only if not ready, and exactly one F2 artifact tag. State next command as `/plan <artifact-path>` only when status is `READY_FOR_PLAN`; otherwise state the upstream command needed. Then stop.

## F2 artifact tag rules

- `<artifact-path>` must resolve from the current Pi session cwd. If the artifact is written in a repo below or outside that cwd, use an absolute path or session-cwd-relative path in the tag and next command.
- If artifact status is `READY_FOR_PLAN`, include `[DESIGN-READY:<artifact-path>]` on its own line.
- If artifact status is `NEEDS_DECISION`, include `[DESIGN-NEEDS-DECISION:<artifact-path>]` on its own line.
- If artifact status is `BLOCKED`, include `[DESIGN-BLOCKED:<artifact-path>]` on its own line.

## Artifact template

```markdown
# Implementation Design: <feature>

Date: <date>
Status: READY_FOR_PLAN | NEEDS_DECISION | BLOCKED
Source spec: <path>
Source discovery: <path>

## Selected approach

## Alternatives considered

| Approach | Pros | Cons | Decision |
|---|---|---|---|

## Module / seam / interface design

## Data model / schema / migrations

## API contracts

## UI / interaction design

## Non-functional design implications

- Performance:
- Accessibility:
- Reliability:
- Observability/logging:
- Security/privacy:

## Documentation / release notes impact

## Reuse guardrails

| Existing thing | Reuse rule | Do not build |
|---|---|---|

## Deep-module / deletion-test check

- Module boundaries:
- Interfaces:
- Why this is not a shallow wrapper:
- What can be deleted if this is removed:

## ADR recommendation

## Validation implications

## Implementation constraints

## Risk acceptance register

| Risk | Impact | Disposition | User acceptance / mitigation evidence |
|---|---|---|---|

## Resolved questions

| Question | Answer | Source |
|---|---|---|

## Risks and open questions

Use `None` when status is `READY_FOR_PLAN`; otherwise list only questions/risks that still require `NEEDS_DECISION`/`BLOCKED`.

## Readiness for plan

- Ready: yes/no
- Blockers:
- Recommended next command: `/plan <this artifact path>`
```

---
name: spec-writing
description: Spec / PRD writing for the staged workflow. Use only when invoked by `/spec` or when explicitly asked to work on that staged command.
---

# Spec Writing

Purpose: convert approved Discovery + Alignment into a precise implementation-independent spec.

## Rules

- Command-only. Do not trigger from ordinary requests unless `/spec` is invoked.
- Read the discovery artifact first. Read referenced code/docs/tests only when needed to resolve ambiguity.
- Source artifact gate: continue only when discovery status is `READY_FOR_SPEC` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing key decisions, or unclear, write a `Status: BLOCKED` spec artifact explaining what must be resolved, recommend rerunning `/discovery-alignment <feature idea>` or fixing that artifact, and stop. Do not recommend `/design`.
- Ask until goals, non-goals, acceptance criteria, ownership, test seams, validation contract, material risks, and risk dispositions are clear.
- Use `ask_user_question` for every unresolved user decision, material risk acceptance, and code/artifact-unanswerable question. Ask exactly one question per tool call.
- Before marking `READY_FOR_DESIGN`, every material risk must be accepted by the user, mitigated by an explicit spec constraint, deferred as a non-goal, or blocking.
- Never leave open questions in a ready spec. If a question could affect product behavior, data/API/permission/privacy, UX, validation, rollout, reversibility, scope, or non-goals, ask it or mark `NEEDS_DECISION`/`BLOCKED`.
- Do not design implementation details yet.
- Keep reuse/build-on-top decisions from discovery.
- Write one artifact under `.scratch/agent-workflow/specs/` with status `READY_FOR_DESIGN`, `NEEDS_DECISION`, or `BLOCKED`.
- Include exactly one F2-compatible artifact tag on its own line in the final response.
- Stop after artifact summary and next command/blocker.

## Spec quality bar

A spec is ready when:

- acceptance criteria are testable
- explicit non-goals prevent scope creep
- data/API/permission/privacy constraints are stated or marked not applicable
- validation command/manual validation is clear
- documentation/release-note impact is stated or marked not applicable
- relevant non-functional requirements are stated or marked not applicable
- no hidden product decisions, unaccepted material risks, or open questions remain

## Required flow

1. Validate that the artifact path exists. If missing or ambiguous, ask one question for the correct path.
2. Read the discovery artifact fully. Read referenced code/docs/tests only when needed to resolve ambiguity.
3. Source artifact gate: continue only if discovery status is `READY_FOR_SPEC` or clearly equivalent. If status is `NEEDS_DECISION`, `BLOCKED`, missing key decisions, or unclear, write a `Status: BLOCKED` spec artifact explaining what must be resolved, recommend rerunning `/discovery-alignment <feature idea>` or fixing that artifact, and stop. Do not recommend `/design`.
4. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
5. Ask user questions for load-bearing product, data ownership, permissions, UX, privacy, rollout, reversibility, validation, non-goal decisions, and material risk acceptance. One question per `ask_user_question` call. Every material risk must be accepted by the user, mitigated by an explicit spec constraint, deferred as a non-goal, or blocking before `READY_FOR_DESIGN`.
6. If spec-stage questions reveal a discovery-level decision, write a `Status: NEEDS_DECISION` or `Status: BLOCKED` spec artifact explaining the upstream discovery issue, then stop and tell the user to update discovery before continuing.
7. Write artifact path: `.scratch/agent-workflow/specs/YYYY-MM-DD-<slug>-spec.md`.
8. Final response: artifact path, goals/non-goals summary, risk dispositions, blockers/open questions only if not ready, and exactly one F2 artifact tag. State next command as `/design <artifact-path>` only when status is `READY_FOR_DESIGN`; otherwise state the upstream command needed. Then stop.

## F2 artifact tag rules

- `<artifact-path>` must resolve from the current Pi session cwd. If the artifact is written in a repo below or outside that cwd, use an absolute path or session-cwd-relative path in the tag and next command.
- If artifact status is `READY_FOR_DESIGN`, include `[SPEC-READY:<artifact-path>]` on its own line.
- If artifact status is `NEEDS_DECISION`, include `[SPEC-NEEDS-DECISION:<artifact-path>]` on its own line.
- If artifact status is `BLOCKED`, include `[SPEC-BLOCKED:<artifact-path>]` on its own line.

## Artifact template

````markdown
# Spec: <feature>

Date: <date>
Status: READY_FOR_DESIGN | NEEDS_DECISION | BLOCKED
Source discovery: <path>

## Problem

## Goals

## Non-goals

## Users / scenarios

## Acceptance criteria

- [ ] <criterion>

## Reuse / build-on-top decisions

| Decision | Existing pattern/module | Rationale |
|---|---|---|

## Data ownership and lifecycle

## API / permission / privacy constraints

## UX requirements

## Non-functional requirements

- Performance:
- Accessibility:
- Reliability:
- Observability/logging:
- Security/privacy beyond explicit constraints:

## Documentation / release notes impact

## Test seams

## Validation contract

One-command validation:

```bash
<command>
```

Manual/device validation if needed:

## Rollout / reversibility

## Risk acceptance register

| Risk | Impact | Disposition | User acceptance / mitigation evidence |
|---|---|---|---|

## Resolved questions

| Question | Answer | Source |
|---|---|---|

## Risks and open questions

Use `None` when status is `READY_FOR_DESIGN`; otherwise list only questions/risks that still require `NEEDS_DECISION`/`BLOCKED`.

## Readiness for design

- Ready: yes/no
- Blockers:
- Recommended next command: `/design <this artifact path>`
````

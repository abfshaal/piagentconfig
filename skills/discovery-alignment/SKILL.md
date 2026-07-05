---
name: discovery-alignment
description: Codebase-grounded Discovery + Alignment for the staged workflow. Use only when invoked by `/discovery-alignment` or when explicitly asked to work on that staged command.
---

# Discovery + Alignment

Purpose: align user intent with codebase reality before spec writing.

## Rules

- Command-only. Do not trigger this skill from ordinary feature requests unless `/discovery-alignment` is invoked or the user explicitly asks for this staged command.
- Inspect relevant code/docs/tests before asking questions.
- Read the relevant slice, not the whole repo.
- Use bounded discovery: cap commands, files, lines, and search output before launching scouts.
- Use `discovery-scout` only for narrow, budgeted reconnaissance.
- Split broad/cross-cutting features into narrow scout slices; do not use one catch-all scout.
- If code can answer a question, cite evidence instead of asking.
- Use decision-tree grilling lightly: identify load-bearing decision branches, resolve dependent branches in order, and avoid scattered unrelated questions.
- Use `ask_user_question` for user decisions, material risk acceptance, and code-unanswerable questions. Ask exactly one question per tool call; repeat as needed.
- When asking, include the decision/risk/question, code evidence if any, recommended answer/options, and why it matters.
- Before marking `READY_FOR_SPEC`, every material risk must have a disposition: accepted by the user, mitigated by an explicit constraint, deferred as a non-goal, or blocking.
- Never leave open questions in a ready artifact. If a question could affect product behavior, schema/data, API, permissions/privacy/security, UX, validation, rollout, reversibility, scope, or non-goals, ask it or mark `NEEDS_DECISION`/`BLOCKED`.
- Sharpen fuzzy or overloaded terms when code/docs suggest a more precise domain term.
- Probe material behavior decisions with concrete scenarios/edge cases.
- `CONTEXT.md`/ADR notes are optional. Look for them only if they are obvious during bounded orientation or already referenced by the repo/request; never create them, require them, or block discovery because they are absent.
- Parent owns questions; child subagents only gather evidence.
- Write one artifact under `.scratch/agent-workflow/discovery/`.
- Include exactly one F2-compatible artifact tag on its own line in the final response.
- Stop after artifact summary and next command.

## Scouting safety

Default parent orientation budget:

- Max 5 shell commands.
- Max 5 files opened.
- Max 80 lines per file.
- Stop once enough information exists to define scout slices.

Default scout budget:

- Max 25 tool calls.
- Max 8 files read in detail.
- Max 120 lines per file.
- Max 1000 total lines of source/docs returned by tools across the whole run.
- Max 80 `rg` result lines per command.

When discovery is broad:

- Use 2-4 narrow scouts by subsystem or question.
- Give each scout one slice and one budget.
- Ask scouts to return `NEEDS_CONTEXT` with proposed narrower slices if budget is insufficient.
- Prefer concise evidence tables over copied source.

Unsafe scouting patterns to avoid:

- Broad `rg` over `src`, `tests`, and `docs` without `head` caps.
- Whole-file dumps via `cat`, `sed`, `nl`, or uncapped shell pipelines.
- Asking one scout to cover architecture, UI, persistence, API, config, tests, docs, risks, and questions at once.
- Continuing to read after enough evidence exists for Discovery + Alignment.

## Good questions and risk acceptance

Ask when a decision or risk materially changes:

- product behavior
- scope or non-goals
- data ownership/lifecycle
- API contract
- permissions/privacy/security
- UX or rollout
- validation strategy
- reversibility

## Required flow

1. If no feature idea was provided, ask one `ask_user_question` for it and continue.
2. Do Level 0 repo orientation with strict limits: max 5 shell commands, max 5 files opened, max 80 lines per file. Identify project type, likely entry points, tests, docs, and nearby conventions. Do not read the whole repo.
3. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
4. Decide scout shape before launching children:
   - If the feature is narrow, launch one `discovery-scout` with one explicit code slice and a budget.
   - If the feature is broad/cross-cutting, launch 2-4 `discovery-scout` tasks, each scoped to one subsystem or question. Do not ask one scout to inspect architecture, UI, persistence, API, config, tests, and docs all at once.
   - If you cannot define a narrow scout slice from Level 0 evidence, ask one user question or do one more bounded orientation pass; do not launch a vague scout.
5. Every scout task must include this budget block or a stricter one:
   - `Max 25 tool calls; max 8 files read in detail; max 120 lines per file; cap rg/find output with head; return NEEDS_CONTEXT instead of exceeding budget.`
6. Ask scouts for code evidence, reuse inventory, existing patterns, test seams, risks, and questions code cannot answer within their slice only.
7. Read only the files needed to verify important scout claims. Do not trust child summaries blindly. Use the same bounded-read rules as scouts.
8. Organize unresolved uncertainty into decision branches. For each branch, record code evidence, status, and the decision/question needed. Resolve dependent branches before unrelated branches when practical.
9. Ask user questions for unresolved product/scope/UX/data/validation/rollout/reversibility/non-goal decisions and material risk acceptance. Use code evidence, recommended options, and concrete scenarios when useful. Every material risk must be accepted by the user, mitigated by an explicit constraint, deferred as a non-goal, or blocking before `READY_FOR_SPEC`.
10. Write artifact path: `.scratch/agent-workflow/discovery/YYYY-MM-DD-<slug>-discovery-alignment.md`.
11. Final response: artifact path, key decisions, risk dispositions, blockers/open questions only if not ready, exactly one F2 artifact tag, and next command: `/spec <artifact-path>` only when ready. Then stop.

## F2 artifact tag rules

- `<artifact-path>` must resolve from the current Pi session cwd. If the artifact is written in a repo below or outside that cwd, use an absolute path or session-cwd-relative path in the tag and next command.
- If artifact status is `READY_FOR_SPEC`, include `[DISCOVERY-READY:<artifact-path>]` on its own line.
- If artifact status is `NEEDS_DECISION`, include `[DISCOVERY-NEEDS-DECISION:<artifact-path>]` on its own line.
- If artifact status is blocked for any reason, include `[DISCOVERY-BLOCKED:<artifact-path>]` on its own line.

## Artifact template

```markdown
# Discovery + Alignment: <feature>

Date: <date>
Status: READY_FOR_SPEC | NEEDS_DECISION | BLOCKED

## Feature idea

## User intent

## Relevant codebase slice

- Files/modules inspected:
- Entry points:
- Data/API/UI surfaces:
- Tests/validation surfaces:
- Scout slices used:
- Scout budget outcome:

## Code evidence

| Question | Evidence | Decision/Implication |
|---|---|---|

## Existing patterns to reuse

## Reuse inventory

| Existing thing | Where | How to reuse | Risk if ignored |
|---|---|---|---|

## Decision branches

| Branch | Status | Evidence | Decision / needed question |
|---|---|---|---|

## User decisions

## Explicit non-goals

## Risks and constraints

## Risk acceptance register

| Risk | Impact | Disposition | User acceptance / mitigation evidence |
|---|---|---|---|

## Resolved questions

| Question | Answer | Source |
|---|---|---|

## Questions code could not answer

Use `None` when status is `READY_FOR_SPEC`; otherwise list only questions that still require `NEEDS_DECISION`/`BLOCKED`.

## Context / ADR notes

Optional; fill only if existing repo docs/ADRs are found or the feature creates an ADR-worthy decision. Absence of these files is not a blocker.

- Terms to clarify:
- ADR-worthy decisions:

## Readiness for spec

- Ready: yes/no
- Blockers:
- Recommended next command: `/spec <this artifact path>`
```

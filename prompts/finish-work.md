---
description: Run final validation and compare implementation to spec/plan
argument-hint: "<spec-or-plan-artifact-path>"
---

You are running staged workflow command `/finish-work`.

Spec or plan artifact path: `$ARGUMENTS`

This command runs only the final validation / branch finish stage.

Success criteria:

- Run the final validation contract when possible.
- Compare actual diff to spec acceptance criteria and non-goals.
- Confirm no scope creep, missing reuse decision, or validation evidence gap.
- Produce one final report under `.scratch/agent-workflow/reports/`.
- Include `[FINAL-REPORT:<report-path>]` on its own line in the final response so F2 opens the report.
- Stop after final report summary.

Required flow:

1. Validate artifact path. If missing or ambiguous, ask one question for the correct path.
2. Read the given artifact. If it is a plan, read linked spec/design/discovery. If it is a spec, read linked discovery and locate matching plan/report if present.
3. Ensure private scratch is ignored: if inside a git repo, append `.scratch/` to `.git/info/exclude` if missing. Do not edit tracked `.gitignore`.
4. Inspect current git diff/status. Do not run destructive git commands.
5. Run final validation contract from spec/plan when possible. Capture command, exit code, and output summary.
6. Launch fresh review-only agents if useful:
   - `spec-reviewer` for acceptance criteria and non-goals
   - `reuse-reviewer` for scope/reuse drift
   - `validation-reviewer` for evidence gaps
7. Write report path: `.scratch/agent-workflow/reports/YYYY-MM-DD-<slug>-final-report.md`.
8. Final response: report path, pass/fail summary, validation evidence, unresolved risks, and `[FINAL-REPORT:<report-path>]` on its own line. The report path in the tag must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs from session cwd. Then stop.

Final report template:

```markdown
# Final Work Report: <feature>

Date: <date>
Status: PASS | PASS_WITH_NOTES | BLOCKED | FAIL
Source artifact: <path>
Source spec: <path>
Source plan: <path>

## Git status / diff summary

## Acceptance criteria comparison

| Criterion | Status | Evidence |
|---|---|---|

## Non-goal check

## Reuse / simplicity check

## Validation evidence

| Command | Exit code | Output summary |
|---|---:|---|

## Manual validation

## Remaining risks

## Recommended follow-up
```

---
name: diagnose-bug
description: Manual-only disciplined debugging loop. Use only when explicitly invoked by /diagnose-bug or /skill:diagnose-bug; reproduces or reasons about a bug via evidence, hypotheses, probes/tests, and regression checks. No edits unless --fix is explicitly requested.
disable-model-invocation: true
---

# Diagnose Bug

Purpose: debug by evidence, not guess-patching.

## Rules

- Manual-only. Do not auto-load or auto-run.
- Default mode is diagnosis/report only. No edits unless user includes `--fix` or explicitly asks to patch.
- If fixing, keep change minimal and validate regression.
- Prefer reproduce → minimize → hypothesize → instrument/test → fix → regression-test.
- Do not mask symptoms with broad fallback code.

## Flow

1. Capture symptom, expected behavior, actual behavior, environment, and recent changes.
2. Reproduce with smallest command/manual path available.
3. Locate likely code seam from stack trace/logs/tests/search.
4. List hypotheses ranked by evidence.
5. Add/read smallest probe or failing test when practical.
6. Confirm root cause before proposing/fixing.
7. Validate fix and regression path if fixing.

## Output

- Symptom summary
- Reproduction status
- Evidence collected
- Ranked hypotheses
- Confirmed/root cause or current best lead
- Minimal fix plan or patch summary
- Regression test/validation
- Remaining unknowns

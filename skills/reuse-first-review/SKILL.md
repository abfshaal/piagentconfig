---
name: reuse-first-review
description: Reuse-first and simplicity review for the staged workflow. Use inside `/implement-plan`, `/finish-work`, or explicit staged review tasks.
---

# Reuse-First Review

Purpose: stop agents from over-adding when existing code should be reused.

## Rules

- Review actual artifacts/diffs/files, not summaries.
- Prefer reuse, deletion, and local changes over new abstractions.
- Flag unapproved dependencies, config, files, modules, wrappers, and nice-to-haves.
- Check explicit non-goals.
- Check whether approved reuse/build-on-top decisions were honored.

## Review questions

- Did implementation use named existing modules/patterns?
- Did it duplicate behavior already present?
- Did it introduce shallow wrappers or pass-through modules?
- Does the interface hide meaningful complexity or just rename it?
- What can be deleted if this feature is removed?
- Did it add scope not in acceptance criteria?
- Could the same result be achieved with fewer files or smaller changes?

## Findings format

- Severity
- Evidence path/line
- Why this violates reuse/simplicity
- Smallest safe fix
- Whether fix is must-do or optional

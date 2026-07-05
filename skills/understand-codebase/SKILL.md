---
name: understand-codebase
description: Manual-only codebase orientation skill. Use only when explicitly invoked by /understand-codebase or /skill:understand-codebase; maps repo structure, domain terms, entrypoints, tests, commands, and risks without editing files.
disable-model-invocation: true
---

# Understand Codebase

Purpose: build compact, evidence-backed map of unfamiliar repo. No edits.

## Rules

- Manual-only. Do not auto-load or auto-run.
- One-shot orientation command. Do not treat this as a staged workflow.
- Read before answering. Do not guess architecture.
- No file edits, commits, or generated artifacts unless user explicitly asks.
- Prefer bounded discovery over full repo crawl.
- Cite file paths and line/section evidence when possible.
- Separate facts, inference, and unknowns.

## Default budget

- Max 8 shell commands.
- Max 8 files opened initially.
- Max 160 lines per file unless file is clearly key.
- Cap `rg`/`find` output with `head`.
- Stop when enough map exists.

## Flow

1. Identify repo root, language/framework, package/build files, docs, tests.
2. Read README/docs/context/ADR if present.
3. Inspect entrypoints and representative tests.
4. Map main modules, data flow, runtime commands, test commands.
5. Find naming/domain vocabulary and important project conventions.
6. Return concise orientation with evidence and next useful commands.

## Output

- Repo type
- How to run/build/test
- Entry points
- Main modules and responsibilities
- Domain terms/glossary
- Data flow / control flow
- Existing patterns to reuse
- Test seams
- Risky/unclear areas
- Suggested next investigation

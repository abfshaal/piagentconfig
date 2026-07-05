---
name: trace-symbol
description: Manual-only symbol tracer. Use only when explicitly invoked by /trace-symbol or /skill:trace-symbol; traces a function, class, component, route, type, command, or config key through definitions, callers, tests, and data flow without editing files.
disable-model-invocation: true
---

# Trace Symbol

Purpose: answer “what is this thing, who uses it, and how safe is it to change?”

## Rules

- Manual-only. Do not auto-load or auto-run.
- No edits.
- Prefer exact search, then structural follow-up.
- Cite paths and relevant snippets/line ranges when possible.
- If the target is ambiguous or multiple symbols match, ask one clarifying question or present likely matches.

## Flow

1. Locate definition(s).
2. Locate exports/imports/callers/usages.
3. Locate tests/stories/docs/config references.
4. Trace runtime path: inputs, transforms, side effects, outputs.
5. Identify invariants and safe change seams.
6. Summarize evidence and unknowns.

## Output

- Definition
- Callers/usages
- Runtime/data flow
- Tests/docs references
- Side effects
- Safe change points
- Risks and unknowns
- Suggested next command/check

---
name: zoom-out
description: Manual-only broader-context explanation for a file, folder, feature, or confusing code area. Use only when explicitly invoked by /zoom-out or /skill:zoom-out; explains how the slice fits the whole system without editing files.
disable-model-invocation: true
---

# Zoom Out

Purpose: explain a code slice in system context.

## Rules

- Manual-only. Do not auto-load or auto-run.
- No edits.
- Start from requested file/folder/symbol/problem.
- Read nearby code plus enough higher-level context to explain role.
- Cite concrete paths.
- Avoid broad repo crawl unless user asks.

## Flow

1. Inspect target slice.
2. Find parent module, callers/routes/config/tests.
3. Identify upstream inputs and downstream effects.
4. Explain why the code exists and what system concept it implements.
5. Note safe change points, risky coupling, and missing context.

## Output

- One-sentence role
- Where it lives in architecture
- Inputs/outputs/dependencies
- Related files/tests
- Important invariants
- Safe changes vs risky changes
- What to inspect next

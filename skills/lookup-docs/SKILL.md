---
name: lookup-docs
description: Manual-only documentation lookup skill. Use only when explicitly invoked by /lookup-docs or /skill:lookup-docs; finds official docs/source/types/examples for APIs, packages, errors, and version-specific behavior with citations.
disable-model-invocation: true
---

# Lookup Docs

Purpose: answer external API/package/tool questions with cited, current sources.

## Rules

- Manual-only. Do not auto-load or auto-run.
- Prefer official docs first, then source/types/changelog, then high-signal examples.
- Fetch actual pages before making claims when possible.
- Include version caveats from repo/package lock/config.
- Separate documented facts from inference.
- No edits unless user separately asks.

## Flow

1. Identify package/tool/API and version from project files when relevant.
2. Search/fetch official docs or source.
3. Verify exact API names, signatures, options, behavior, and caveats.
4. Check examples only after primary source.
5. Return answer with citations and project-specific implication.

## Output

- Short answer
- Project version/context
- Official docs/source evidence
- Caveats / version notes
- Example usage if useful
- What to verify locally

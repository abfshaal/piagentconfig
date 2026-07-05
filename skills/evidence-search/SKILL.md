---
name: evidence-search
description: Manual-only evidence gathering skill. Use only when explicitly invoked by /evidence-search or /skill:evidence-search; gathers repo and/or web evidence for a claim, question, behavior, dependency, or decision, separating facts from inference.
disable-model-invocation: true
---

# Evidence Search

Purpose: collect enough evidence to answer a question responsibly.

## Rules

- Manual-only. Do not auto-load or auto-run.
- No edits.
- Search repo first for project-specific claims unless user requests web-only.
- Fetch original web sources before citing them when possible.
- Cite repo paths and fetched web sources where possible.
- Separate facts, inference, gaps, and confidence.
- Keep output concise and evidence-backed.

## Flow

1. Restate question/claim.
2. Decide repo/web/both search scope.
3. Gather bounded evidence from files, docs, tests, commits when available.
4. Gather web evidence from original/high-authority sources when needed.
5. Compare evidence, note contradictions, answer with confidence.

## Output

- Question / claim
- Search scope
- Evidence table: source, finding, implication
- Facts
- Inference
- Gaps / unknowns
- Confidence
- Recommended next check

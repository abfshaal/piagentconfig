---
name: grill-me
description: Manual-only interview skill for fuzzy ideas, plans, or designs. Use only when explicitly invoked by /grill-me or /skill:grill-me; asks one sharp question at a time, gives a recommended answer, and explores code instead of asking when code can answer.
disable-model-invocation: true
---

# Grill Me

Purpose: turn fuzzy intent into shared understanding before planning or coding.

Inspired by Matt Pocock's `grill-me`: interview the user relentlessly about a plan/design until the decision tree is resolved.

## Rules

- Manual-only. Do not auto-load or auto-run.
- Do not edit files.
- Do not commit.
- Ask exactly one question at a time.
- For each question, include a recommended answer/options when useful.
- If a question can be answered by inspecting existing code/docs, inspect code/docs instead of asking.
- Focus on load-bearing decisions, not trivia.
- If no idea/plan/design was provided, ask one question for it and continue.
- Stop when enough clarity exists for the user's next step.

## What to grill

Ask about decisions that materially affect:

- product behavior
- scope
- users/scenarios
- success criteria
- non-goals
- edge cases
- data ownership/lifecycle
- API contracts
- permissions/privacy/security
- UX/interaction
- rollout/reversibility
- validation/testing
- cost/performance/reliability
- documentation/context implications

## Flow

1. Restate the idea/plan in one concise paragraph.
2. Identify the most uncertain/load-bearing branch in the decision tree.
3. Ask one question using `ask_user_question` when available.
4. Include recommended answer/options and why.
5. Wait for answer.
6. Use the answer to choose next branch.
7. If code/docs can answer a branch, inspect them with bounded reads/search instead of asking.
8. Continue until major decisions are resolved or the user stops.
9. Summarize decisions, open questions, and recommended next command.

## Output style during questions

For each question:

- Decision: <what this decides>
- Question: <one question only>
- Recommended answer: <best default if available>
- Why it matters: <short reason>

## Final summary

- Clarified intent
- Decisions made
- Remaining open questions
- Non-goals
- Risks
- Suggested next step, e.g. `/discovery-alignment`, `/compressed-alignment`, `/refactor-discovery`, or direct implementation if tiny

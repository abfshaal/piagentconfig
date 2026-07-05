---
name: refactor-discovery
description: Heavy refactor workflow stage 1 — debt diagnosis. Use only when invoked by `/refactor-discovery`; measures where code causes friction (hotspots, duplication, tangles, coverage gaps) and ranks refactor candidates by leverage. No edits.
---

# Refactor Discovery (Debt Diagnosis)

Purpose: find and rank refactor candidates from measured evidence, not vibes.

This is not feature discovery. Feature discovery asks the user what they want; refactor discovery asks the code where it hurts. Evidence comes from metrics, git history, and friction probes. The user is asked only to confirm friction is real and to pick between candidates.

## Rules

- Command-only. Do not trigger from ordinary requests.
- No code edits. No commits.
- Diagnose with measurements first, opinions second. Every candidate needs at least one measured signal.
- Read project `CONTEXT.md`, docs, and ADRs first when present.
- Bounded discovery; do not crawl the whole repo unless the target is repo-wide and the user asked for that.
- Ask the user only: to narrow an overly broad target, to confirm a friction story matters, or to choose between equally ranked candidates. One question per `ask_user_question` call.
- Write exactly one artifact under `.scratch/agent-workflow/refactor/discovery/`.
- Ensure `.scratch/` is ignored via `.git/info/exclude` when inside git; do not edit tracked `.gitignore`.
- Stop after artifact summary, one F2 tag, and next command.

## Diagnosis signals

Collect what is cheap and relevant; skip what is not. Cap each probe's output with `| head`.

- **Churn × complexity hotspots**: `git log --since=<window> --name-only --format=` piped to `sort | uniq -c | sort -rn | head -20`, crossed with file size / function count. Files that are both big and frequently edited are where refactoring pays.
- **Duplication**: targeted `rg` for repeated signatures, copy-paste variants, parallel switch/if-chains over the same discriminator.
- **Tangles**: import cycles, layering violations, many callers importing the same implementation details.
- **Coverage posture**: do tests exist over the candidate, do they run green, do they test interface or implementation trivia.
- **Friction probes**: pick 1-2 representative recent or plausible changes ("add a new provider", "rename this field") and count what they touch today: files, call sites, test edits. Record as a concrete friction story — this becomes the after-measurement at the end of the pipeline.
- **Cruft**: speculative config, one-adapter seams, unused abstractions, dead exports.

## Vocabulary

- **Module**: anything with an interface and implementation.
- **Interface**: everything callers must know: types, invariants, error modes, ordering, config.
- **Depth**: leverage behind interface; a deep module hides meaningful behavior behind a simple interface.
- **Seam**: place behavior can be altered without editing in place.
- **Adapter**: concrete implementation at a seam. Two-adapter rule: one adapter = hypothetical seam; two = real.
- **Locality**: concentration of change/bugs/knowledge.
- **Deletion test**: if the module disappears, does complexity vanish or spread?

## Candidate ranking

Rank by **leverage = friction removed ÷ risk**.

- Friction removed: measured friction story improvement, duplication eliminated, hotspot calmed.
- Risk: breadth of compatibility surface touched × coverage posture (weak coverage = high risk) × blast radius.
- Strength labels: `Strong` (measured friction, preservable behavior, validation path exists), `Worth exploring` (real friction, needs baseline work first), `Speculative` (signal without a friction story — usually not worth pipeline weight; note and drop).

## Required flow

1. Parse target area/request. If too broad, do one bounded orientation pass and ask one narrowing question.
2. Ensure `.scratch/` exclude. Read CONTEXT.md/ADRs if present.
3. Run diagnosis signals over the target (bounded, capped output).
4. Write 1-2 concrete friction stories with today's measured cost.
5. Identify compatibility surfaces and blast radius per candidate.
6. Note known bugs / failing baselines as quarantine items, never refactor scope.
7. Rank candidates by leverage. Mark each Strong / Worth exploring / Speculative.
8. Status: `READY_FOR_BASELINE` when at least one Strong/Worth-exploring candidate has a friction story and plausible validation path; `NEEDS_DECISION` when the user must pick or confirm friction; `BLOCKED` when target is unsafe/too broad/no validation path.
9. Write artifact: `.scratch/agent-workflow/refactor/discovery/YYYY-MM-DD-<slug>-refactor-discovery.md`.
10. Final response: artifact path, top candidates with their measured signals, exactly one F2 tag, next command `/refactor-baseline <artifact-path> [candidate-id]` only when ready. Stop.

## Artifact template

```markdown
# Refactor Discovery: <target>

Date: <date>
Status: READY_FOR_BASELINE | NEEDS_DECISION | BLOCKED
Target: <target>

## Diagnosis evidence

| Signal | Measurement | Source command | Implication |
|---|---|---|---|

## Friction stories

| Story | Cost today (files/call sites/test edits) | Candidate that fixes it |
|---|---|---|

## Refactor candidates (ranked by leverage)

| ID | Strength | Candidate | Files/modules | Measured signal | Friction story | Compatibility surfaces | Coverage posture | Blast radius | Risk |
|---|---|---|---|---|---|---|---|---|---|

## Known bugs / failing baseline quarantine

## Deletion-test / seam notes

## Context / ADR notes

## User decisions needed

## Non-goals

## Recommended candidate

## Readiness

- Ready: yes/no
- Blockers:
- Recommended next command: `/refactor-baseline <this artifact path> <candidate-id>`
```

## F2 tag rules

Artifact paths in tags and next commands must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when repo root differs.

- `[REFACTOR-DISCOVERY-READY:<path>]`
- `[REFACTOR-DISCOVERY-NEEDS-DECISION:<path>]`
- `[REFACTOR-DISCOVERY-BLOCKED:<path>]`

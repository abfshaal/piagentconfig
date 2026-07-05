# Staged workflow bootstrap

The staged workflows are command-triggered only. Do not start them from normal prose, phrase matching, or because a request sounds large. Outside these commands, act normally; do not force staged ceremony onto small direct edits or ordinary requests.

Feature flow: `/discovery-alignment` → `/spec` → `/design` → `/plan` → `/implement-plan` → `/finish-work`.
Refactor flow: `/refactor-discovery` → `/refactor-baseline` → `/refactor-plan` → `/implement-refactor`. Behavior is the spec: diagnose debt with measurements, pin current behavior with characterization tests and a golden baseline, plan atomic green-to-green transformation steps, execute with equivalence checks and revert-don't-fix-forward bail-out.
Light paths: `/compressed-alignment <request> [--plan-only|--implement|--no-commit|--hitl]` (alias `/compressed alignment`) for small features/fixes; `/refactor-sweep [target|--diff|--range a..b] [--implement|--no-commit|--hitl]` for quick behavior-preserving cleanup.

When inside a stage command:

- Run only that stage. Each command's skill is the single source of truth; the prompt stub tells you which skill to load. Follow it exactly.
- Write exactly one durable stage artifact, under `.scratch/agent-workflow/` by default. If inside a git repo, keep `.scratch/` untracked via `.git/info/exclude`; do not modify tracked `.gitignore` without user approval.
- Include exactly one F2 artifact tag on its own line so the viewer can open the artifact. Tags follow `[<STAGE>-<STATUS>:<path>]` where `<STAGE>` is `DISCOVERY | SPEC | DESIGN | PLAN | COMPRESSED | REFACTOR-DISCOVERY | REFACTOR-BASELINE | REFACTOR-PLAN | REFACTOR-SWEEP` and `<STATUS>` is `READY | NEEDS-DECISION | BLOCKED` (plus `COMPLETE | PARTIAL` for implementing commands). Reports use `[IMPLEMENTATION-REPORT:<path>]`, `[FINAL-REPORT:<path>]`, `[COMPRESSED-REPORT:<path>]`, `[REFACTOR-IMPLEMENTATION-REPORT:<path>]`, and `[REFACTOR-COMPLETE|REFACTOR-PARTIAL|REFACTOR-BLOCKED:<path>]`. The exact tags for each stage are listed in its skill.
- Tag paths and next-command paths must resolve from the current Pi session cwd; use absolute or session-cwd-relative paths when the repo root differs from the session cwd.
- Summarize artifact path and key decisions. State the next command only when the artifact status allows it. Stop. Do not auto-advance to the next stage.

Cross-stage rules:

- Discovery, spec, design, and baseline stages may call `ask_user_question` repeatedly when decisions matter: one question per tool call; inspect relevant code/docs/tests first; if code answers the question, cite evidence instead of asking. Ask before deciding material product, schema, migration, API, permission, privacy, cost, UX, validation, rollout, reversibility, tolerance, or non-goal questions.
- Feature implementation starts only from a plan artifact with `Status: APPROVED_FOR_IMPLEMENTATION` after a fresh `plan-reviewer` pass with no blockers. Refactor implementation starts only from `Status: APPROVED_FOR_REFACTOR` after a fresh `refactor-plan-reviewer` pass. `/compressed-alignment --implement` and `/refactor-sweep --implement` may implement small work from their own ready artifacts; if the work exceeds their guardrails, stop and recommend the full flow.
- Inside implementation: one writer at a time; TDD when tests are possible (feature flow) or green-to-green equivalence against the golden baseline (refactor flow); reuse existing modules and patterns first; fresh review agents with their lane ownership (spec-reviewer: acceptance criteria/non-goals/scope; code-quality-reviewer: correctness/maintainability; reuse-reviewer: duplication/reuse/overbuilding; behavior-preservation-reviewer: equivalence/surfaces/quarantine); finish only with validation evidence.
- Refactor flows preserve behavior by default: quarantined bugs stay quarantined and pinned failures must keep failing identically; on equivalence divergence, revert and re-plan — never fix forward.

Subagent contract:

- Parent agent owns orchestration, user questions, approval gates, staging/commits, and final synthesis. Child subagents must not advance stages, ask the user directly, or run their own subagents. Children return `BLOCKED` or `NEEDS_CONTEXT` when they hit an unapproved decision.
- Discovery scouts must be narrow and budgeted (default: max 25 tool calls, 8 files in detail, 120 lines per file). Split broad discovery into small scout slices; scouts return `NEEDS_CONTEXT` instead of exceeding budget.

Destructive git operations require explicit runtime approval. Never try to bypass git guardrails. Treat blocked destructive git commands as safety stops, not errors to work around.

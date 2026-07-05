# Pi Agent Setup

Portable Pi setup repo for my current agent workflow.

Local folder on this machine:

```bash
~/pi-agent-setup
```

Use this repo to move Pi extensions, subagents, skills, prompts, and safe config to another machine. Secrets and sessions stay local.

## What Is Included

### `agents/`

Custom `pi-subagents` agent definitions. These show up when `pi-subagents` is installed.

Included agents:

- `plan-implementer`, `fix-worker` — staged implementation workers
- `code-quality-reviewer`, `reuse-reviewer`, `spec-reviewer`, `validation-reviewer` — fresh-context review lanes
- `discovery-scout`, `task-planner`, `plan-reviewer` — staged planning/discovery helpers
- `refactor-implementer`, `refactor-plan-reviewer`, `behavior-preservation-reviewer` — refactor workflow helpers
- `frontend-design-agent` — frontend prototype/design helper

Typical use inside Pi:

```text
Use code-quality-reviewer to review this diff.
Use discovery-scout to inspect the auth flow.
Run parallel reviewers for correctness, reuse, and validation.
```

### `extensions/`

Custom Pi extensions/tools/UI behavior.

Included highlights:

- `ask-user-question.ts` — structured ask-user tool
- `web-tools.ts` — web search/fetch tools
- `staged-progress.ts` — staged implementation progress widget
- `plan-viewer.ts` — artifact/plan viewer support
- `destructive-git-guard.ts` — guardrails for destructive git commands
- `caveman-mode.ts` — terse response style
- `karpathy-guidelines.ts` — coding behavior guidelines
- `markdown-hygiene.ts` — markdown output rules
- `frontend-design-mode.ts` — frontend design workflow command support
- `filechanges/` — file change viewer extension, uses `diff`

### `prompts/`

Slash prompt templates. Use these in Pi by typing `/` and selecting prompt name.

Main workflow prompts:

- `/discovery-alignment`
- `/spec`
- `/design`
- `/plan`
- `/implement-plan`
- `/finish-work`
- `/compressed-alignment`
- `/refactor-discovery`
- `/refactor-baseline`
- `/refactor-plan`
- `/implement-refactor`
- `/refactor-sweep`

Utility prompts include `/diagnose-bug`, `/lookup-docs`, `/trace-symbol`, `/understand-codebase`, `/zoom-out`, `/grill-me`.

### `skills/`

Agent skill files. Pi can auto-load these when matching task, or you can call skills directly.

Included groups:

- Even Hub / G2 app development: `quickstart`, `template`, `sdk-reference`, `device-features`, `glasses-ui`, `handle-input`, `simulator-automation`, `test-with-simulator`, `build-and-deploy`
- Staged workflow: `discovery-alignment`, `spec-writing`, `implementation-design`, `task-planning`, `implementation-loop`, `plan-reviewing`, `reuse-first-review`
- Refactor workflow: `refactor-discovery`, `refactor-baseline`, `refactor-plan`, `implement-refactor`, `refactor-sweep`
- Utility: `diagnose-bug`, `evidence-search`, `lookup-docs`, `trace-symbol`, `understand-codebase`, `zoom-out`, `grill-me`, `production-readiness`

### `config/`

Safe machine config copied from `~/.pi/agent`.

- `settings.json` — default model/provider, package list, subagent model overrides, theme
- `models.json` — local Ollama provider config
- `keybindings.json` — custom keybindings
- `APPEND_SYSTEM.md` — global appended system instructions

Not included: auth, sessions, trust state, API keys.

### `patches/`

Small local helper scripts for Pi UI behavior.

### Scripts

- `install.sh` — install this repo into `~/.pi/agent/settings.json`, copy safe config, install npm deps
- `sync-from-pi.sh` — refresh this repo from current `~/.pi/agent`

## New Machine Setup

Install Pi first:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Clone this repo:

```bash
git clone git@github.com:<YOUR_USER>/<YOUR_REPO>.git ~/pi-agent-setup
cd ~/pi-agent-setup
./install.sh
```

Then authenticate on that machine:

```bash
pi
/login
```

Or use env vars if you prefer API keys:

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
pi
```

Restart Pi after install, or run `/reload` inside Pi.

## Alternative: Install Directly As Pi Package

If you only want resources and do not need config copied:

```bash
pi install npm:pi-subagents
pi install git:github.com:<YOUR_USER>/<YOUR_REPO>
```

Private repo SSH form:

```bash
pi install git:git@github.com:<YOUR_USER>/<YOUR_REPO>.git
```

This loads `extensions/`, `skills/`, `prompts/`, `themes/`, and `agents/` via `package.json`. It does not copy `config/settings.json`, `models.json`, or `APPEND_SYSTEM.md`. For full setup, clone repo and run `./install.sh`.

## Update This Repo From Current Machine

After changing your live Pi setup:

```bash
cd ~/pi-agent-setup
./sync-from-pi.sh
```

Review before commit:

```bash
git status
git diff
npm run check:secrets
```

Commit:

```bash
git add .
git commit -m "Update Pi agent setup"
```

Push:

```bash
git push
```

If remote not set yet:

```bash
git remote add origin git@github.com:<YOUR_USER>/<YOUR_REPO>.git
git branch -M main
git push -u origin main
```

## Security Rules

Never commit:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/sessions/`
- `~/.pi/agent/run-history.jsonl`
- `~/.pi/agent/trust.json`
- `.env` files
- API keys or provider tokens
- `node_modules/`

Quick check:

```bash
npm run check:secrets
git ls-files | grep -E '(^|/)(auth.json|sessions/|run-history.jsonl|trust.json|node_modules/|\.env)'
```

No output from second command = good.

## Ollama Notes

`config/models.json` defines local provider `ollama` at:

```bash
http://localhost:11434/v1
```

To use same local model:

```bash
ollama pull qwen3-coder-next:q4_K_M
ollama serve
```

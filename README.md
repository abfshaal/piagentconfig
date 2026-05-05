# Pi Agent Setup

Portable Pi coding-agent setup repo.

Goal: clone this repo on another machine, run one script, get same Pi extensions, skills, keybindings, model config, and Plannotator config.

## Included

- `extensions/` — custom Pi extensions/tools/UI behavior
- `skills/` — custom Agent Skills, including Even Hub/G2 workflows
- `config/settings.json` — default provider/model/thinking/packages
- `config/models.json` — custom Ollama provider/model config
- `config/keybindings.json` — custom keybindings
- `config/plannotator.json` — Plannotator phase/tool config
- `patches/` — local Pi patch helper scripts
- `package.json` — Pi package manifest so Pi can load this repo directly

## Not Included

Never committed:

- `~/.pi/agent/auth.json` — OAuth/API credentials
- `~/.pi/agent/sessions/` — conversation history, may contain secrets or private code
- `node_modules/`
- old backups: `*.bak.*`, `*.disabled.*`, `patches/backups/`

## Install on New Machine

Install Pi first:

```bash
npm install -g @mariozechner/pi-coding-agent
```

Clone repo:

```bash
git clone <YOUR-REPO-URL> ~/pi-agent-setup
cd ~/pi-agent-setup
./install.sh
```

Then restart Pi or run:

```bash
/reload
```

Authenticate per machine:

```bash
pi
/login
```

Or use provider env vars, for example:

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
```

## Ollama Notes

`config/models.json` defines local provider `ollama` at:

```bash
http://localhost:11434/v1
```

If you want same local model:

```bash
ollama pull qwen3-coder-next:q4_K_M
ollama serve
```

## Update This Repo From Current Machine

From this machine, refresh copied Pi resources:

```bash
cd ~/pi-agent-setup
./sync-from-pi.sh
```

Then review and commit:

```bash
cd ~/pi-agent-setup
git status
git diff
git add .
git commit -m "Update Pi agent setup"
```

## Push to GitHub

Create empty repo on GitHub first, then:

```bash
cd ~/pi-agent-setup
git branch -M main
git remote add origin git@github.com:<USER>/pi-agent-setup.git
git push -u origin main
```

HTTPS variant:

```bash
git remote add origin https://github.com/<USER>/pi-agent-setup.git
git push -u origin main
```

## Security Check Before Push

Run:

```bash
git status
git diff --cached
npm run check:secrets
```

Also verify these do not exist in git:

```bash
git ls-files | grep -E '(^|/)(auth.json|sessions/|node_modules/|\.env)'
```

No output = good.

## How Pi Loads This Repo

`install.sh` adds this repo path to `~/.pi/agent/settings.json` under `packages`.

Pi package manifest in `package.json` exposes:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

So Pi can load resources from cloned repo without copying all resource files into `~/.pi/agent`.

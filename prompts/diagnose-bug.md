---
description: Diagnose a bug with reproduce → minimise → hypothesise → probe/test → fix plan loop
argument-hint: "<bug description|error|test failure> [--fix]"
---

You are running command `/diagnose-bug`.

Bug/context/flags: `$ARGUMENTS`

Load the `diagnose-bug` skill and follow it exactly; it is the single source of truth for this command. If the skill cannot be loaded, read `/Users/abdulraheem.shaal1/.pi/agent/skills/diagnose-bug/SKILL.md` directly and follow it. If neither works, stop and tell the user; do not improvise.

Default is diagnosis/report only: do not edit files unless `--fix` is present or the user explicitly asks to patch.

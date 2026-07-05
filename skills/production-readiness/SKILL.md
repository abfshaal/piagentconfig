---
name: production-readiness
description: Production-readiness review for git diffs, commit ranges, or changed code. Use when checking whether implementation is safe for production systems, especially multi-process, horizontally scaled, distributed, queued, cached, or stateful deployments where local-only behavior may hide failures.
---

# Production Readiness

Purpose: review an implementation against production realities before deploy. Focus on differences between local/dev execution and production systems: multiple processes, multiple instances, shared state, queues, caches, migrations, concurrency, idempotency, external services, rollout, rollback, and observability.

## Default mode

Review-only. Do not edit files unless the user explicitly asks for fixes.

## Invocation shapes

User may provide:

- `/skill:production-readiness --diff`
- `/skill:production-readiness --from <start-commit> --to <end-commit>`
- `/skill:production-readiness --range <start-commit>..<end-commit>`
- `/skill:production-readiness <path-or-area>`
- `/skill:production-readiness <freeform deploy concern>`

If no target is clear:

1. Prefer current git diff when inside a git repo and diff exists.
2. Otherwise ask one question for the target diff, commit range, branch, path, or concern.

## Fit

Use this skill for:

- changes that worked locally but may fail under production topology
- multi-process or multi-instance deployments
- job queues, background workers, cron/schedulers, event consumers, pub/sub
- caches, distributed locks, rate limits, retries, idempotency
- database migrations, schema changes, transactions, read/write consistency
- config/env/secret differences across deploy environments
- startup/shutdown/lifecycle behavior
- external service integration and timeout/retry behavior
- deploy/rollback readiness
- observability and alerting gaps

Do not use as a generic code-quality review unless production risk is the target.

## Inputs to establish

Before judging risk, discover or infer:

- production topology: one process, many processes, many hosts, containers, workers, schedulers
- changed files/hunks or commit range
- runtime entrypoints touched
- persistence surfaces touched: DB, cache, filesystem, object store, queues
- shared state surfaces touched: globals, singletons, in-memory caches, locks, counters
- external surfaces touched: APIs, webhooks, events, config keys, env vars
- deploy shape: rolling deploy, blue/green, one-shot migration, worker restart behavior
- validation available: tests, staging run, logs, metrics, simulator/manual checks

If topology is unknown, infer from repo evidence first. Ask only when production risk cannot be assessed without it.

## Required flow

1. Determine review target.
2. If inside git, inspect status and avoid touching unrelated dirty work.
3. For `--diff`, inspect current uncommitted diff with stats and targeted hunks.
4. For commit range:
   - verify endpoints with `git rev-parse`
   - inspect commits in order with `git rev-list --reverse <start>..<end>`
   - use targeted `git show --stat --name-status --find-renames <sha>` and relevant hunks
   - keep per-commit risks separate from whole-range risks
5. Orient on production topology:
   - package/deploy config
   - process manager/container config
   - worker/queue/scheduler entrypoints
   - DB/cache/config wiring
   - README/deploy docs/infra files when present
6. Map changed code to runtime process(es): web/API, worker, scheduler, CLI, startup, migration, shared library.
7. Review production risk categories below.
8. Rank findings by severity:
   - `BLOCKER`: likely prod failure, data loss, outage, security issue, unsafe migration, or no safe rollback
   - `HIGH`: plausible production-only failure or significant operability gap
   - `MEDIUM`: risk needs mitigation or staging validation
   - `LOW`: note or hardening opportunity
9. Separate must-fix before deploy from follow-up hardening.
10. Provide concrete validation commands/checks and rollout/rollback recommendations.

## Production risk categories

### Process topology and routing

Check whether changed behavior runs in the intended process:

- code added to web process but production path runs in worker, or reverse
- scheduler/cron only exists in one instance or every instance unexpectedly
- local dev process combines roles that prod splits
- startup hooks run on every process/replica unintentionally
- side effects depend on process-local memory
- background task created in request process but prod worker owns it

### Shared state and concurrency

Check for unsafe assumptions:

- module/global/in-memory state expected to be shared across processes
- counters, locks, caches, or dedupe stored only in memory
- race conditions under parallel requests/workers
- missing idempotency keys for retries/events/webhooks/jobs
- non-atomic read-modify-write
- transaction boundary too small/large/missing
- duplicate consumers or concurrent schedulers

### Persistence and migrations

Check data safety:

- migration order vs code deploy order
- backward/forward compatibility during rolling deploy
- nullable/default/backfill issues
- destructive schema/data changes without rollback
- long-running locks or table rewrites
- read/write consistency and replicas
- serialization format changes
- data ownership/lifecycle unclear

### Queues, events, and background jobs

Check async behavior:

- at-least-once delivery not handled
- retries duplicate side effects
- poison messages unhandled
- job payload schema not versioned
- queue name/routing mismatch between local and prod
- scheduler duplicate execution across replicas
- worker concurrency/resource limits ignored
- ordering assumptions not guaranteed

### Cache and distributed coordination

Check cache correctness:

- cache invalidation missing across processes
- TTL too long/short for changed semantics
- local cache hides stale distributed state
- distributed lock missing timeout/fencing token
- cache key missing tenant/user/env/version dimensions
- warmup behavior differs in prod

### Config, env, secrets, and feature flags

Check deploy environment:

- env var required but not documented/defaulted safely
- local default unsafe for prod
- config loaded in wrong process or only at startup when dynamic expected
- secret missing rotation/error behavior
- feature flag rollout/kill switch missing for risky path
- tenant/region/env separation wrong

### External services and network behavior

Check resilience:

- no timeout, retry, backoff, circuit breaker, or idempotency
- retry can amplify outage or duplicate writes
- rate limits ignored
- partial failure not handled
- webhook signature/security missing
- API contract/version mismatch
- local mock behavior hides production constraints

### Lifecycle and deploy/rollback

Check operations:

- startup order dependency
- graceful shutdown missing for in-flight jobs/requests
- rolling deploy incompatible with new/old code mix
- rollback blocked by migration/data shape
- one-time task may run multiple times
- health/readiness checks do not cover new dependency

### Observability and incident response

Check ability to detect/debug:

- no structured logs around new prod-critical path
- no metric/counter/timer for new job/API/external call
- no alert or dashboard signal for failure mode
- errors swallowed or logged without identifiers
- correlation/request/job IDs missing
- validation evidence unavailable after deploy

### Security, privacy, and compliance

Check production exposure:

- sensitive data logged
- auth/permission check only on local/client path
- cross-tenant data access/cache key risk
- secret/token exposure
- PII retention/lifecycle changed
- public API behavior changed without contract review

## Evidence sources

Prefer bounded evidence from:

- `git diff --stat`, `git diff --name-status`, targeted hunks
- `git show` for commit ranges
- package/build/start scripts
- Docker/compose/k8s/process manager configs
- queue/worker/scheduler entrypoints
- DB migration files and schema docs
- config/env examples
- tests for changed behavior
- README/deploy docs/ADR/CONTEXT when present

Do not crawl whole repo unless target truly requires it. Stop when enough evidence supports risk assessment.

## Output

Return concise markdown:

```markdown
# Production Readiness Review: <target>

## Verdict

READY | READY_WITH_GUARDS | NOT_READY | NEEDS_CONTEXT

## Target reviewed

- Mode: diff | range | path | concern
- Commits/files:
- Production topology inferred:

## Executive summary

## Production topology map

| Runtime/process | Evidence | Changed code impact |
|---|---|---|

## Findings

| Severity | Finding | Evidence | Production failure mode | Required action |
|---|---|---|---|---|

## Multi-process / distributed-state review

- Process routing:
- Shared state:
- Idempotency/concurrency:
- Queues/jobs/schedulers:
- Cache/locks:

## Deployment safety

- Migration compatibility:
- Rolling deploy safety:
- Rollback safety:
- Feature flag / kill switch:

## Validation plan

| Check | Command/manual step | Expected result | Covers |
|---|---|---|---|

## Observability / operations

- Logs:
- Metrics:
- Alerts:
- Runbook/debug notes:

## Must fix before production

## Safe rollout recommendation

## Remaining unknowns
```

## Verdict definitions

- `READY`: no material production-only risks found; validation adequate.
- `READY_WITH_GUARDS`: deploy acceptable only with listed validation, rollout guard, monitor, or rollback plan.
- `NOT_READY`: blocker/high risk must be fixed before production.
- `NEEDS_CONTEXT`: production topology, deploy process, or target diff is too unclear to judge.

## Fix mode

If user explicitly asks to fix:

- make minimal targeted edits only for accepted must-fix items
- do not broaden into generic cleanup
- preserve behavior unless user approves behavior change
- validate with the review's validation plan
- summarize changed files and remaining production risks

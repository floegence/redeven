---
type: Storage Contract
title: Flower storage ownership and migrations
tags: [ai, storage, sqlite, migrations, floret]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Floret owns canonical Agent formats; Redeven owns product facts and uploads. Unknown, future, drifted or invalid state blocks Flower without resetting data or disabling the core Runtime. Floret owns bounded startup recognition and background per-thread migration.

# Contract

## Storage owners
Redeven consumes the exact published Floret version in go.mod with `GOWORK=off`.

Each validated dependency closure publishes atomically; retained sources retire only after complete verification. The oldest v2-v5 snapshots reserve historical identities through a resumable scan before new-thread admission. Segmented stores admit new threads immediately. Redeven uses public status, thread preparation and per-thread media contracts and never decodes upstream records.

Published Floret v7.87.0 removes hidden Activity field preparation from ordinary startup, retains summary metadata on large activity admission, batches explicit locator writes and skips same-value SQLite upserts. Its recent manifest cache is bounded, memory-only and owned upstream. No new host indexes, full-text indexes or duplicate conversation storage are introduced. First disclosure may still prepare the selected complete activity once; this is not a claim of field-granular cold preparation.

Cancellation, shutdown and execution-context settlement resolve canonical control records through Floret. The host keeps the original Stop request and does not read or reconstruct upstream conversation bodies to settle it.

Flower freezes the displayed `turn_id` and `run_id` with one `client_request_id`
at Stop click time. Desktop, Env App, HTTP and RPC pass these fields unchanged
to published Floret cancellation preconditions. An unconfirmed retry first
resynchronizes and retains the same target and key; if execution changed, it
resolves that old action without stopping the replacement. A fresh subsequent
click may target the new execution. Server-side stale targets return conflict.
Legacy internal callers may omit the complete optional target; partial targets
are rejected. Stop response remains acknowledgement-only; canonical views own
settlement. Existing stop presentation and copy are unchanged.

Floret projects canonical interrupted/cancelled terminal facts into subsequent
model context alongside retained partial output. The host adds no transcript
message or process-state claim. Restart, Fork, Retry, compaction and rendered
cache revision remain upstream-owned. Ordinary Stop preserves queued inputs;
Send now retains the explicit upstream stop-and-promote transition.


A read-state failure cannot become a core Runtime constructor failure or a synthetic read record.

Redeven also owns the [Agent Plugins registry](flower-agent-plugins.md), snapshots and installation data. Its schema-1 SQLite store is separate from canonical conversation history; credential references resolve through SecretsStore schema 4. Neither owner decodes Floret records.

## Execution configuration
Product schema 11 to 12 adds bounded execution configuration to the existing
admission authority. It retains original provider/model and RunOptions for
continuations; it is not a second lifecycle table. Historical rows remain valid
with no inferred configuration. Floret owns host-work facts, final output,
notice admission, unknown recovery and continuation identity.

## Readonly checks and owner transactions
`sqliteutil` owns WAL-aware readonly preflight, integrity checks and complete SQLite snapshots for product and read-state owners. Inspection never creates missing data or runs a migration.

Owner transactions migrate without full startup snapshots. The [recovery contract](flower-backup-and-recovery.md) governs completion of admitted replacements and retirement of obsolete automatic backups.

## Frozen historical queue conversion
The migration-only `pendinginputlegacy` package owns the complete interpretation of historical queue bytes: session identity, options, context shapes, default values, resource metadata and normalization limits.

The v4-to-v5 product transaction imports canonical pending inputs through Floret's public idempotent import API, records necessary product authority and removes retired source tables before commit. Owner versions and canonical records remain the progress authority; no build-driven snapshot journal is created.

## Resource and authorization retention
Product upload references retain resources for every canonical thread that contains them, including ordinary forks, nested forks and restored inputs.

After activation, product recovery pages settings, retains each thread's complete descriptors and promotes eligible admitted input. Failures retain the cleanup gate while independent threads recover. Tool-media collection keeps its complete global inventory, write gate and idle constraint.

Bounded keyset maintenance and compaction stop and drain with their owning generation.

# Boundaries

Floret is the sole authority for canonical history, execution and queue semantics. Historical byte interpretation never grants current execution permission.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Source.
- `redeven:internal/ai/flower_precise_stop_integration_test.go` - Real HTTP/SSE, restart, next provider input, delayed stop and replay.
- `redeven:internal/ai/flower_graceful_stop_integration_test.go` - Confirmed process exit and retained terminal output.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.decisionSurface.browser.test.tsx` - Frozen target, stable retries, rollover and unchanged presentation.

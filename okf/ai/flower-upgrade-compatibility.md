---
type: Compatibility Contract
title: Flower historical writer acceptance
tags: [ai, compatibility, fixtures, release]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Immutable fixtures come from locked released Redeven writers; current tests copy and verify them. The released Floret v7.102.0 host-work fixture also qualifies unknown-outcome history through the public runtime and Redeven DTO. Browser acceptance exercises the same serialized Activity contract.

# Contract

The compatibility baseline is Redeven `10ce4c15212c7f4b6d2a449507b9e47d6bc31d1a` with published Floret `v7.5.0`.

The manifest binds the archive, every stored file and producer by SHA-256 and records source commit, Floret version, Go toolchain, scenario names and canonical IDs needed by assertions.

Qualification uses fake providers and copied synthetic data; production startup never resumes a user's task automatically.

Compatibility checks must cover legal
status values, attention/counts, bounded final presentation, and rendered history;
API symbol compatibility and database-open success alone are insufficient. The immutable [v7.106.2 completed fixture](../../internal/ai/testdata/host-work-completed-v7.106.2/manifest.json)
retains its exact published writer, frozen module files and checksums. `TestFlowerReleasedCompletedHostWorkHistory` qualifies completed history, forks,
nested forks, explicit continuation, rejected completed-turn Retry and restart
through public product APIs without startup replay.

# Turn-kind consumer contract

The selected published Floret module owns `runtime.TurnKind`. Generate the
shared TypeScript type and predicate with
`GOWORK=off go run ./internal/cmd/flower-turn-contract`; `--check` compares the
committed output with public Go export data. The ordinary Go contract test and dependency
boundary reject drift, including additive upstream values. Ordinary turns omit
kind; compaction, Goal continuation and host-work continuation retain theirs.
Never drop a valid kind or synthesize a user request to make history load.

`TestTerminalCompletionAutomaticallyContinuesAndRetainsOutput/automatic`
recreates the complete canonical current through the real Service, published
Floret, a fake provider and an actual short-lived terminal process, then repeats
the read after restart. Its reviewed synthetic
[detail fixture](../../internal/flower_ui/src/testdata/hostWorkCompletedDetail.json)
normalizes identities/timing and includes the required catalog metadata.
Regenerate only after review with `UPDATE_FLOWER_HOST_WORK_FIXTURE=1`.
The same serialized current passes the real frontend adapter, indexed cache,
new-turn live delta/reconnect and browser reopening; preserve both final answers
and one admitted user message. Unknown kinds and malformed references remain
errors. Activity-only checks do not qualify a complete conversation response.

# Boundaries

Historical producers are immutable evidence, never helpers linked into current production code. Source-only CI validates provenance; the dedicated exact commit qualification owns execution and product continuation evidence.

# Evidence

- `redeven:internal/ai/tool_correction_history_compatibility_test.go` - Exact v7.69.1 failures through Retry/Send/Fork/restart.

- `redeven:internal/ai/testdata/upgrade/10ce4c152/manifest.json` - Tests.

---
type: AI Tool Contract
title: Computer target selection across threads
description: Resolve logical targets without side effects and preserve each authorized thread selection across turns and restart.
tags: [ai, computer-use, targets, permissions]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

The Computer Use Runtime owns target selection over Redeven product settings.
The registry owns target identities and readiness snapshots only. An unbound
thread defaults to the managed browser, never to whichever adapter registered
first. Selection cannot authorize an action, imply readiness or grant control
of a shared desktop. Policy, readiness, safety and cancellation checks remain
mandatory; unavailable stored targets fail rather than selecting another target.

# Resolution and execution

A model may omit `target`, use `current`, or request an authorized logical kind.
Resolution is read-only. For `current`, the Runtime reads that canonical thread's
`computer_target_id`; an empty value resolves `browser.managed`. Explicit kinds
resolve only registered, unambiguous targets. Concrete IDs remain internal
compatibility inputs and execution provenance, not mandatory model parameters.

The existing tool boundary resolves identity, checks target policy, prepares the
adapter and assesses safety. Only then does it persist selection, before sending
the action to the adapter. A persistence failure executes nothing. A target or
safety rejection leaves the previous selection intact. An action failure retains
the selected target and follows existing effect-outcome rules; it does not
silently send the next action to a previous target. Calls carry canonical thread,
turn, run and tool identities from the host, never from model arguments.

Missing managed-browser resources remain a browser setup error even when a native
desktop helper exists. Persisted selection never skips the actual readiness
handshake. Resolving one thread does not mutate any other thread or a global
`current`. Store errors retain their own failure boundary rather than becoming
target-unavailable errors.

# Persistence and fork

The migrated product store is the only selection store; no in-memory binding
mirror exists. The Service attaches that store before admitting turns. Schema
version 7 appends a default-empty column to the existing version 6 thread settings
under the permanent product lineage. All previous migration edges remain intact;
verification and data changes commit atomically. No Floret-owned tables are read.

Restart restores the chosen target identity, not helper liveness or control
ownership. New and forked threads start unbound and resolve the managed browser.
Forked history may contain parent keyframes; it does not grant control of the
parent target. Deleting product settings removes selection. Setting a target for
an unknown or deleted thread fails and never recreates that thread.

# Qualification limits

Focused tests cover switching, thread isolation, rejected actions, storage failure,
restart, fork and deletion. Shared-target control ownership, takeover and remote
session qualification remain separate incomplete requirements. Persisted target
selection must not be presented as proof of those capabilities.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - read-only resolution and store binding.
- `redeven:internal/ai/run.go` - authorized selection before adapter dispatch.
- `redeven:internal/ai/target_registry.go` - deterministic identity resolution.
- `redeven:internal/ai/computer_target_binding_test.go` - switching and failure boundaries.
- `redeven:internal/ai/threadstore/computer_target_test.go` - migration, rollback and restart.

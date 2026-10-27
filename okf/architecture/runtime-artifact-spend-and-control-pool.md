---
type: Runtime Security Contract
title: Runtime artifact spend and control pool
description: Persist, spend, replenish, and revoke opaque Flowersec control artifacts without replay or authority duplication.
tags: [architecture, runtime, security, artifacts]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Remote control and data artifacts are opaque, single-spend capabilities. Redeven binds each Lease to one digest-global tombstone, persists idempotent bootstrap and top-up request identities, and rejects stale, duplicate, malformed, expired, or cross-environment responses before a connection can consume them. Pool replenishment and relink are terminal state transitions, never silent fallback.

# Contract

Before any remote data or control artifact can be spent, its Lease callback creates and fsyncs one no-overwrite ledger tombstone keyed only by the artifact's SHA-256 digest. Product channel, generation, sequence, and wrapper labels cannot create a second burn identity for the same opaque artifact.

A legacy local `Direct` config has no matching Portal-side durable sequence authority, so Redeven erases it into a revoked digest tombstone and requires relinking instead of importing it as usable capacity.

# Boundaries

This concept owns Redeven's durable spend ledger and control-artifact pool. Product channel, generation, sequence, and wrapper labels cannot create another burn identity, and legacy direct configuration cannot be imported as usable capacity.

# Evidence

- `redeven:internal/agent/agent.go:1149` - Binds Lease spending to the digest-global durable ledger before connection.

- `redeven:internal/agent/control_artifact_pool.go:67` - Validates top-up and ACK replay through one pending request.

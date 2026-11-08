---
type: Runtime Security Contract
title: Runtime artifact spend and control pool
tags: [architecture, runtime, security, artifacts]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Opaque single-spend control/data artifacts bind each Lease to a digest-global tombstone. Persist idempotent bootstrap/top-up identities; reject stale, duplicate, malformed, expired or cross-environment responses. Replenishment/relink are explicit terminal transitions, never silent fallback.

# Contract

Before any remote data or control artifact can be spent, its Lease callback creates and fsyncs one no-overwrite ledger tombstone keyed only by the artifact's SHA-256 digest. Product channel, generation, sequence, and wrapper labels cannot create a second burn identity for the same opaque artifact.

A legacy local `Direct` config has no matching Portal-side durable sequence authority, so Redeven erases it into a revoked digest tombstone and requires relinking instead of importing it as usable capacity.

# Boundaries

This concept owns Redeven's durable spend ledger and control-artifact pool. Product channel, generation, sequence, and wrapper labels cannot create another burn identity, and legacy direct configuration cannot be imported as usable capacity.

# Evidence

- `redeven:internal/agent/agent.go:1149` - Source.

---
type: Validation Guide
title: Control-plane capacity qualification
tags: [gateway, controlplane, validation, performance]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Control-plane capacity qualification measures ten thousand enrolled Runtime sessions through real Nginx/TLS, MySQL, and canonical authority decisions. The harness uses production heartbeats, signed Gateway observations, and credential recovery. A full acceptance result combines client latency and recovery counts with independent server CPU, RSS, database, queue, and challenge-backlog measurements.

# Contract

The independent load host runs `scripts/run_controlplane_capacity.sh manifest.json private-results`.

The configs must contain currently valid artifact pools.

Missing infrastructure or measurements leave qualification pending.

## Control heartbeat policy
Registration and successful heartbeat responses carry one session-scoped `heartbeat_policy` with `revision`, `interval_ms`, and `offline_timeout_ms`. Older revisions cannot replace a newer policy; equal revisions with different content terminate the unusable session.

Capacity qualification is defined in `redeven:okf/operations/controlplane-capacity-qualification.md`.

# Boundaries

This opt-in qualification is separate from ordinary commit and push checks. Credentials remain only in restricted load-host state, while published reports contain counts, timings, and actual machine specifications.

# Evidence

- `redeven:internal/agent/controlplane_capacity_qualification_test.go` — Production control lifecycle and signed Gateway observation harness.

- `redeven:scripts/run_controlplane_capacity.sh` — Independent load-host invocation and fixture limits.

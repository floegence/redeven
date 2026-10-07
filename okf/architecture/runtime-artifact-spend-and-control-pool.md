---
type: Runtime Security Contract
title: Runtime artifact spend and control pool
description: Persist, spend, replenish, and revoke opaque Flowersec control artifacts without replay or authority duplication.
tags: [architecture, runtime, security, artifacts]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Remote control and data artifacts are opaque, single-spend capabilities. Redeven binds each Lease to one digest-global tombstone, persists idempotent bootstrap and top-up request identities, and rejects stale, duplicate, malformed, expired, or cross-environment responses before a connection can consume them. Pool replenishment and relink are terminal state transitions, never silent fallback.

# Contract

Before any remote data or control artifact can be spent, its Lease callback creates and fsyncs one no-overwrite ledger tombstone keyed only by the artifact's SHA-256 digest. Product channel, generation, sequence, and wrapper labels cannot create a second burn identity for the same opaque artifact. Each tombstone records the signed expiry and a one-hour post-expiry retention boundary; cleanup removes only valid records past that boundary, while malformed records remain fail-closed and a fixed entry cap rejects new spends instead of deleting live authority.

Desktop Cloud sandbox expiry is renewed by the owning bootstrap document through a no-argument native bridge. Main binds the request to the root WebContents, saved provider account and environment, coalesces concurrent renewals, obtains a new RCPP open-session, validates its exact sandbox origin and Env App binding, and exchanges its one-shot boot ticket into the same Electron session cookie store. Tokens never enter the renderer. Both proxy and application acquisition retry the rejected request once after renewal; revoked authorization stays terminal. The five-minute sandbox cookie lifetime and server permission checks remain unchanged.

The remote control source persists a bounded `control_artifact_pool_v1` rather than one reusable artifact. Bootstrap sends a canonical 32-byte delivery request ID and persists that ID together with the local environment and agent identities in a sidecar before the request; an uncertain retry replays the same tuple, and a sidecar for another provider or environment fails closed rather than being overwritten. Only exact HTTP `409/BOOTSTRAP_DELIVERY_EXPIRED` atomically rotates that request ID and receives one automatic retry; another expiry or an ambiguous failure stops. A newly issued recovery ticket survives the Provider's pre-claim expired-delivery lookup and can authorize the rotated request, while a ticket already claimed by the original issuance is rejected and requires the caller to obtain another newly issued ticket. The response is exact-decoded within the 512 KiB pool limit, rejects unknown or retired `direct` fields, and requires mutually unique artifact digests and channels. The sidecar is unlinked only after the returned configuration commits. An unlink directory-sync error is completion-safe: the caller succeeds, and a crash can at most restore the same idempotent request tuple.

Each pool entry has a Portal-owned sequence, independent artifact channel, digest, expiry, and terminal tombstone. Acquisition selects the lowest usable sequence beyond the fixed refresh horizon, commits the digest-global spend ledger before connecting, then atomically matches generation, sequence, digest, expiry, and bytes while erasing opaque material. On restart, ledger reconciliation converts any stale unspent config entry into a spent tombstone before another entry can be selected. An authenticated control session tops up through the versioned pool RPC and acknowledges an applied response before clearing its persisted pending request. The exact top-up response echoes the persisted `top_up_request_id_b64u`; Runtime verifies that identity before applying entries, and the response digest covers both the echoed ID and the unsigned pool. Response entries must be internally contiguous and above retained local sequences. They may begin after a missing range when an expired, undelivered outbox already advanced Portal's durable counter; Runtime accepts that forward gap only through the authenticated `server_highest_artifact_sequence`. Response or ACK loss replays the same request and exact response bytes. Portal's exact `top_up_request_expired` RPC error atomically records the latest bounded local terminal request tombstone and clears pending state so a later maintenance tick can allocate a fresh request ID. The Provider accepts at most 65,536 bootstrap and top-up delivery IDs for one logical binding generation, always resolving an accepted ID before checking the bound. Exact RPC `409/control_pool_relink_required` leaves the current pending request terminal and moves Runtime to `relink_required`; it never retries that ID or deletes a Portal replay fence. Other invalid responses also require relinking. Retired `credential-renew` is not a production recovery path. A legacy local `Direct` config has no matching Portal-side durable sequence authority, so Redeven erases it into a revoked digest tombstone and requires relinking instead of importing it as usable capacity.


# Boundaries

This concept owns Redeven's durable spend ledger and control-artifact pool. Flowersec remains the owner of session admission and wire framing; the main [Runtime transport dependencies](runtime-transport-dependencies.md) concept owns how a validated artifact enters a session. Product channel, generation, sequence, and wrapper labels cannot create another burn identity, and legacy direct configuration cannot be imported as usable capacity.

# Evidence

- `redeven:internal/agent/agent.go:1149` - Binds Lease spending to the digest-global durable ledger before connection.
- `redeven:internal/agent/control_artifact_source.go:35` - Selects and burns sequence-bound persisted pool entries.
- `redeven:internal/agent/control_artifact_pool.go:67` - Validates top-up and ACK replay through one pending request.
- `redeven:internal/config/bootstrap.go:215` - Persists and reuses delivery request and runtime identity attempts.
- `redeven:internal/agent/agent.go:1339` - Shares artifact admission and cleanup across remote and local production sessions.

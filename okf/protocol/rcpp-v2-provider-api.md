---
type: Protocol Contract
title: RCPP v2 provider API
description: The provider protocol OpenAPI contract covers discovery, Desktop authorization, environment catalog, runtime health, Desktop open-session, and runtime bootstrap.
tags: [protocol, provider, openapi, desktop]
timestamp: 2026-07-13T00:00:00Z
---
# Summary

Redeven's machine-readable provider integration contract is `spec/openapi/rcpp-v2.yaml`. It is the remaining maintained provider protocol specification after stale human protocol Markdown was removed.

The provider protocol OpenAPI contract covers discovery, Desktop authorization, environment catalog, runtime health, Desktop open-session, and runtime bootstrap.

# Contract

## Mechanism

The OpenAPI contract defines provider discovery under `/.well-known/redeven-provider.json`, Desktop authorization code creation, Desktop connect exchange, Desktop token refresh/revoke, provider account status, environment catalog listing, runtime health query, Desktop open-session material, and runtime bootstrap ticket exchange. Desktop and runtime code consume the same concepts through provider origin, provider id, access point origin, environment public id, runtime health snapshots, Desktop open-session material, bootstrap tickets, and bounded control artifact pools.

Runtime provider and access-point origins are normalized as HTTPS origins only. Userinfo, query, fragment, and non-root paths are rejected rather than stripped into a different apparent authority. Bootstrap exchanges attach the bearer ticket only to the normalized HTTPS origin. Redirects may continue only when the destination remains on the same HTTPS hostname and effective port; cross-origin and HTTPS downgrade redirects fail before a redirected request is sent.

Bootstrap tickets remain memory-only and are used only for the exchange. Before sending, Runtime persists a canonical unpadded-base64url 32-byte `bootstrap_delivery_request_id_b64u` together with the normalized provider and access-point origins, environment identity, local environment identity, and agent instance identity. A retry for the same target reuses that exact tuple so the Provider can replay one encrypted delivery outbox response instead of issuing another pool. A pending tuple for another target fails closed instead of being overwritten. The ticket itself is never written to the sidecar. Only an exact HTTP `409` error envelope with code `BOOTSTRAP_DELIVERY_EXPIRED` retires the request ID: Runtime atomically persists a fresh ID, preserves the remaining target identity, and retries the exchange once. The Provider performs the expired-delivery lookup before claiming the presented ticket, so a newly issued recovery ticket remains usable for the rotated retry. Reusing the ticket already claimed by the original issuance makes the retry fail with `INVALID_BOOTSTRAP_TICKET`; the caller must then obtain another newly issued ticket. A second expiry or any ambiguous response is returned without another automatic attempt. Region serializes the write under the Environment row lock: the same logical binding accepts only a strictly greater generation, otherwise it returns `409/BOOTSTRAP_BINDING_STALE` before revocation or issuance. Different logical bindings have independent generation domains. The same transaction counts bootstrap and top-up delivery rows for the target generation before mutation; delivery 65,536 is allowed, while a new delivery after that bound returns `409/CONTROL_POOL_RELINK_REQUIRED`.

A successful current bootstrap response contains only `control_artifact_pool_v1`: one logical Provider binding generation, fixed target waterline and refresh horizon, an exact response digest, and bounded independently issued entries with contiguous server-owned sequences, mutually unique channel identities and artifact digests, expiries, and opaque Flowersec artifacts. Runtime exact-decodes the response within 512 KiB, rejects unknown fields and any retired `direct` member, validates the pool and digest, commits `config.json`, and then unlinks the pending delivery sidecar. Once unlink succeeds, a directory-sync error does not fail the completed operation because a crash can only restore and replay the same idempotent tuple. If an older local config still contains `Direct`, runtime acquisition preserves only a revoked sequence/digest/expiry tombstone, erases the artifact bytes, and requires a fresh Provider link because the legacy artifact has no durable Portal authorization and sequence ownership.

Control-pool top-up uses an exact wrapper containing `top_up_request_id_b64u` and `pool`. The Provider echoes the canonical 32-byte request ID, includes that field in the response digest together with the unsigned pool, and encrypts the exact response bytes in its delivery outbox. Runtime must match the echoed ID to its persisted pending request before validating or applying entries. Entries in one response are contiguous and above every locally retained sequence, but the first entry need not be the local high-watermark plus one: an older undelivered response may have expired after the Provider durably advanced its sequence. Runtime accepts that forward gap only inside an exact response whose digest and `server_highest_artifact_sequence` validate, then ACKs that authenticated server high-watermark. Response or ACK loss reuses the persisted request ID. An exact `top_up_request_expired` terminal error records one bounded local tombstone, clears the pending request, and permits a later tick to allocate a new ID; it never treats the old ID as reusable.

For one exact logical binding generation, the Provider accepts at most 65,536 bootstrap and top-up delivery request IDs in total. Lookup and exact replay of an accepted ID precede capacity enforcement. At the hard limit, the Provider keeps every current-generation replay fence and rejects a new top-up ID with exact RPC `409/control_pool_relink_required`. Runtime atomically leaves that pending request terminal, enters `relink_required`, performs no further top-up retries, and requires a fresh Provider link to advance the generation. Neither side deletes a current-generation tombstone to recover capacity. Bootstrap remains a distinct response and does not synthesize a top-up request ID.

# Boundaries

Human protocol Markdown is not the source of truth. Provider-facing changes must update the OpenAPI contract and corresponding runtime/Desktop code together. Bootstrap tickets and opaque Flowersec artifacts must not appear in command arguments, startup reports, diagnostics, or non-secret identity metadata. Runtime pool compaction retains at most the configured bounded sequence/digest/expiry terminal records and only the latest terminal top-up request; Portal owns durable request tombstones and their generation-scoped retention.

RCPP providers are external control-plane and access-point authorities, not plugin capability providers. Provider IDs, access point IDs, environment public IDs, Desktop authorization tokens, bootstrap tickets, and direct connection fields must not be reused as plugin installation identities, plugin capability names, plugin broker grants, or plugin runtime leases. Plugins hosted inside Redeven should reach environment and business resources through Local UI session context, released ReDevPlugin brokers, and Redeven-registered adapters rather than by speaking RCPP provider endpoints directly.

# Evidence

- `redeven:spec/openapi/rcpp-v2.yaml:3` - The OpenAPI title names the Redeven Control Plane Provider Protocol.
- `redeven:okf/architecture/plugin-platform-integration.md:75` - RCPP provider credentials are adjacent host mechanisms, not plugin grant planes.
- `redeven:internal/config/state_paths.go:118` - Provider and access-point URL normalization requires a clean HTTPS origin.
- `redeven:internal/config/bootstrap.go:215` - Runtime persists or reuses the delivery attempt before issuing the bootstrap exchange.
- `redeven:internal/config/bootstrap.go:248` - Only the exact expired-delivery response rotates the request ID and receives one automatic retry.
- `redeven:internal/config/bootstrap.go:356` - Runtime attaches the ticket only to the normalized HTTPS exchange and requires a canonical delivery request ID.
- `redeven:internal/config/bootstrap.go:578` - Bootstrap pool validation enforces version, generation, waterline, horizon, bounds, digest, sequence, expiry, and artifact parsing.
- `redeven:internal/agent/control_artifact_pool.go:213` - Top-up validation binds the request, authenticated server high-watermark, forward gap, exact limits, channels, digests, and entries before commit.
- `redeven:internal/agent/control_artifact_pool.go:67` - Top-up maintenance persists exact expired and capacity-exhausted terminal outcomes before selecting another action.
- `redeven:internal/agent/control_artifact_source.go:80` - Retired local Direct input becomes a revoked tombstone and an explicit relink boundary.

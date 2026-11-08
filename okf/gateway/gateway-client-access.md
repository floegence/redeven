---
type: Gateway Contract
title: Gateway device trust and host operations
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Paired devices receive independent Gateway access, never accounts, roles or host-management grants. Verify HTTPS using only that CA, then signed Gateway identity before persisting device trust. Never disable TLS or install global CAs. Packages expire after ten minutes; consumption admits no second device.

# Contract

## Invitations
Host-issued Runtime invitations require Runtime authentication and explicit consent. Client packages are rdgc1/purpose redeven-gateway-client/version1: one-use secret, exact Gateway ID/key, scoped CA and expiry. Parsers reject cross-purpose use, unknown fields, malformed trust and expiry.

Identical original completion may recover response loss. Desktop/Center retain CA in independent records; display names authenticate nothing. Revocation closes that device's channels without affecting another client/Cloud user.

## Private management
Local/SSH/container adapters verify credentials over the private host socket; public URLs expose device access only. Gateway derives capabilities, never caller-selected/persisted device roles. manage_attachments covers invitations/removal; manage_network covers endpoints/listeners/Host restrictions/egress/reevaluation. Issuance/listing/revocation/receipts require current host proof. Both management capabilities exist together only on that verified request. Removing a Desktop registration preserves remote service/data.

All public device keys are listed/revocable, including host-paired keys. Historical host_managed grants no exemption. Trust schema4 atomically migrates1–3 before readiness, preserving identity/access/revocations; unsupported state stays unchanged.

Private management uses host proof independently of device signatures, but a supplied signature must verify. Signed identity retains requested binding audience for exact connection pinning. Applications/service identity require admitted device keys even over private socket. Self-revocation preserves private management/recovery; refresh cannot pair again. Explicit reauthorization creates a fresh key; challenges/old receipts cannot revive revoked keys.

## Mutation recovery
X-Redeven-Operation-ID binds private mutations. A bounded mode-0600 host-only journal persists intent before effect, response afterward. Same ID/body returns saved result; route/body changes conflict. POST /gateway/v6/operations/query reads the original over the private channel. Retain <=1024 operations/24h. Issuance receipts may contain short-lived packages; never expose journal data in diagnostics/public replies. Expiry grants no replay.

Interrupted effect-before-receipt yields OPERATION_RESULT_UNKNOWN without replay. Desktop stores ID privately and queries after response loss. Confirmed failure clears pending state; unknown/expired stays fenced with inspectable ID. Explicit review acknowledgement clears only the verified Gateway's recovery fence. CLI supports --operation-id and operations query --operation-id, exposing ID on failure. Join/rotation/Cloud route/enrollment keep their domain receipts; refresh cannot authorize/resubmit consent.

# Boundaries

Gateway owns transport trust; Runtime owns environment authentication/execution. Center may see plaintext as trusted proxy, so its independent entry protection and owner-approved bindings remain mandatory.

# Evidence

- redeven:internal/environmentcenter/offline_gateway_test.go
- redeven:internal/runtimegateway/protocol/client_access_test.go

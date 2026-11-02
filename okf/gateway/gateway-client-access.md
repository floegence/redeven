---
type: Gateway Contract
title: Gateway device trust and host operations
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Paired client devices receive independent Gateway access, never a user account, role or host-management grant. Public pairing works on a fresh private network through scoped TLS bootstrap. Runtime password/MFA and Web Center single-administrator protection remain separate.

# Contract

## Two different invitations
Host administrators issue Runtime invitation codes for Runtime-owned authenticated exchange and explicit consent. Client access information uses rdgc1 with purpose redeven-gateway-client, version 1, one-use secret, exact Gateway ID/key, scoped TLS CA and expiry. The purpose-specific parsers reject cross-use, unknown fields, malformed trust and expired input.

The client verifies HTTPS with only the delivered connection CA, then verifies the signed Gateway identity before persisting its device trust. It never disables TLS verification or installs a global CA. Access information expires after ten minutes; consumed material cannot pair another device. The original identical pairing completion can recover a lost response.

Desktop and Web Center preserve the CA with their independent Gateway record. Display names identify devices for humans and never authenticate them. Revoking a device rejects new admission and closes its dependent channels without revoking another client or Cloud user.

## Private management
Local/SSH/container adapters reach the private host socket and verify its credential. Public URLs expose only device access. Client capabilities are computed by the Gateway, not selected by the caller or persisted as host authority. manage_attachments covers Runtime invitations, removal and reevaluation; manage_network covers shared endpoints, listeners, Host restrictions and egress policy. Client-code issuance, device listing/revocation and operation receipts require current host proof. Both management capabilities are granted together only for that verified host request; they are not independently assignable device roles. Removing a saved Desktop connection retains the remote service and its data.

## Mutation recovery
Private host mutations carry X-Redeven-Operation-ID. A bounded private journal persists intent before execution and the resulting response afterward. The same ID/body returns the saved result; a different route/body conflicts. POST /gateway/v6/operations/query retrieves the original result over the private host channel. Receipts expire after 24 hours and the journal admits at most 1,024 operations in that window. It is a mode-0600 host-only credential store: issuance receipts can contain the original short-lived access package. Never include its contents in diagnostics or public responses. Expired receipts do not authorize an automatic repeat.

A process interrupted between effect and receipt reports OPERATION_RESULT_UNKNOWN; it never replays that effect. Desktop retains the operation ID in its private credential store and queries it after a lost response. A completed failure clears the pending operation; an uncertain or expired result stays fenced and presents its ID for inspection. An explicit acknowledgement after reviewing current state clears only the saved recovery fence for the verified Gateway; it does not repeat the mutation. CLI mutations accept --operation-id, expose it on failure, and support operations query --operation-id over the same private channel. Runtime join, credential rotation, Cloud route and enrollment continue using their existing domain receipts. Observation/refresh does not create new authorization or resubmit consent.

# Boundaries
Gateway trust controls device transport admission. Runtime owns environment authentication and execution. Web Center is a trusted proxy that may see application plaintext; its entry protection and owner-approved bindings remain mandatory and independent of Cloud.

# Evidence

- redeven:internal/environmentcenter/offline_gateway_test.go — Fresh HTTPS trust, pairing, one-use consumption and revocation without Cloud.
- redeven:internal/runtimegateway/protocol/client_access_test.go — Purpose, lifetime, identity, signature and malformed trust rejection.
- redeven:desktop/src/main/gatewayClientAccess.test.ts — Desktop trust-package validation.
- redeven:internal/gatewayservice/operations_test.go — Restart recovery, conflicting IDs and interrupted-effect fencing.

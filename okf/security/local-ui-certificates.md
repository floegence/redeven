---
type: Security Contract
title: Local UI certificates
description: Manage saved HTTPS identities, explicit file imports and replacements, and independent client trust without interrupting a running Runtime.
tags: [security, local-ui, desktop, certificates]
timestamp: 2026-09-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime owns the saved HTTPS identity and validates it before serving. Desktop exposes explicit certificate creation, import, regeneration, and removal only through the registered management channel. Certificate validity, client trust, and the latest operation result are independent. No operation silently replaces an identity or installs trust. Invalid imports preserve the saved pair; changes affect the next HTTPS start while the running identity and sessions remain intact. HTTP remains the default and requires no certificate.

# Contract

## Identity and trust
The user explicitly creates a device CA with `local-authority device-ca generate` and inspects it with `status`. Runtime startup never generates, replaces, or repairs certificate material.

Public export contains certificate material only, never the key.

## Explicit certificate changes
`import`, `regenerate`, and `remove` require `--confirm`. Reject malformed or extraneous PEM blocks, trailing text, encrypted/mismatched keys, invalid dates, invalid chains, missing SANs, and certificates unsuitable for server authentication.

This supports process-interruption recovery; it does not promise an OS trust rollback or filesystem power-loss durability.

## Coverage during network changes
[Local UI network exposure](local-ui-network-exposure.md) owns the two-second interface refresh and atomic public snapshot.

A signing failure retains only current addresses covered by the previous valid leaf and reports `certificate_refresh_failed`; retries recover automatically. Startup and explicit saved-identity preflight retain their strict validation boundary.

## Desktop interaction and private input
The compact HTTPS panel presents certificate validity, expiry, and system trust separately. Public path, fingerprint, and bounded selectable diagnostics live in the expandable details section.

Saving next-start HTTPS settings remains possible with an unusable certificate, with an explicit startup warning.

# Boundaries

Runtime owns saved identity validation and replacement; Desktop owns explicit management presentation and private file acquisition. Certificate operations cannot silently restart Runtime, install system-wide trust, or expose private material to the renderer.

# Evidence

- `redeven:internal/localui/public_address_refresh_test.go` - Verifies CA continuity, imported coverage, signing recovery, actual TLS/WSS, and established-session survival.

- `redeven:internal/localui/device_identity.go` - Validated imports, locked replacement, interruption recovery, explicit removal, and bind preflight.

- `redeven:internal/localui/device_identity_test.go` - Invalid input preservation, real TLS serving, restart boundaries, CA restore, and transaction recovery.

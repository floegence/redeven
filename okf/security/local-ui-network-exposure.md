---
type: Security Contract
title: Local UI exposure, HTTPS identity and explicit certificate changes
tags: [security, local-ui, desktop, env-app, flowersec]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Runtime owns public listeners, saved HTTPS identity and admission; Desktop presents explicit next-start settings. Signing failure retains only addresses covered by the prior valid leaf, reports certificate_refresh_failed and retries recovery.

# Contract

## Network exposure
### HTTPS certificate ownership
[Certificates](#certificates) owns explicit creation/import/replacement/removal/validation/trust. Startup never creates/repairs identity or falls back to HTTP. Replacement is next-start; running TLS/sessions remain.

### Listener and origin boundary
Accept only canonical authorities derived from actual bound addresses. HTTP loopback routes exact current parent/port-derived plugin child origins exclusively to released Web resource handler, stripping parent credentials and excluding management. Removed parent/different port/network-only/HTTPS cannot use that route. Platform still verifies asset session/origin/ticket/lifetime. flowersec-private-loopback/1 never grants public access.

### Native Desktop default-port recovery
Only native launch with saved localhost:23998 and no explicit one-start bind may opt into --local-ui-default-port-fallback. Custom/numeric/network/wildcard overrides and other errors cannot change ports silently. Old bookmarks do not follow temporary ports.

### Network changes and current reports
Enabled exposure refreshes eligible interfaces every2s with explicit list, including empty. Private endpoints cannot fill absent public addresses. Failures affect availability, not process status, and never expose private management URLs.

### Admission and lifecycle
Network listeners require concrete nonloopback or wildcard, fixed nonzero port and effective password. Occupied explicit ports fail. Flowersec owns admission/session/liveness/dispatch/close/lease loops; no copied host lifecycle.

### Server-owned access configuration
[Two-factor](runtime-two-factor-authentication.md) owns credential authority, verifier migration, TOTP/recovery/replay/revocation. Password change is next-start only when MFA disabled; enabled MFA blocks clearing/replacement and HTTPS downgrade. Catalog-save failure rolls back verifier initialization/replacement/clearing.

## Certificates
### Identity and trust
User explicitly runs local-authority device-ca generate/status. Public export contains certificates, never keys; startup never generates/replaces/repairs them.

### Explicit certificate changes
import/regenerate/remove require --confirm. Reject malformed/extraneous PEM/trailing text/encrypted or mismatched keys/dates/chains/missing SAN/server-auth failures. Process-interruption recovery promises neither OS trust rollback nor power-loss durability.

### Coverage during network changes
Two-second refresh atomically publishes public snapshots. Startup and explicit saved-identity preflight remain strict.

### Desktop interaction and private input
Compact panel separates validity/expiry/system trust; paths/fingerprint/bounded selectable diagnostics are expandable. Saving unusable next-start identity remains possible with explicit startup warning.

# Boundaries

Client trust installation is explicit, outside startup. Missing secure-context capabilities receive specific guidance, never browser-security bypass. Private Desktop requires exact preload provenance/numeric loopback regardless of public HTTP. Certificate actions cannot restart Runtime silently, install system trust or expose keys to renderer. Runtime validates identity; Desktop owns management/private file acquisition.

# Evidence

internal/localui/public_address_refresh.go and public_address_refresh_test.go cover refreshed identity/public snapshots.

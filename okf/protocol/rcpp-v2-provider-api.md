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

The OpenAPI contract defines provider discovery under `/.well-known/redeven-provider.json`, Desktop authorization code creation, Desktop connect exchange, Desktop token refresh/revoke, provider account status, environment catalog listing, runtime health query, Desktop open-session material, and runtime bootstrap ticket exchange. Desktop and runtime code consume the same concepts through provider origin, provider id, access point origin, environment public id, runtime health snapshots, Desktop open-session material, bootstrap tickets, and direct runtime connection information.

Runtime provider and access-point origins are normalized as HTTPS origins only. Userinfo, query, fragment, and non-root paths are rejected rather than stripped into a different apparent authority. Bootstrap exchanges attach the bearer ticket only to the normalized HTTPS origin. Redirects may continue only when the destination remains on the same HTTPS hostname and effective port; cross-origin and HTTPS downgrade redirects fail before a redirected request is sent.

Bootstrap tickets remain memory-only and are used only for the one-time exchange. The returned direct E2EE PSK is persisted in the permission-restricted `secrets.json`, keyed by direct channel id; `config.json` retains only direct transport metadata and `e2ee_psk_set`. Legacy configs are migrated by atomically writing and reading back the PSK before atomically rewriting `config.json`. Credential renewal and provider relinking retain the previous channel secret until the new config metadata commits, so a failed cross-file update preserves a restart path through the previous credentials.

# Boundaries

Human protocol Markdown is not the source of truth. Provider-facing changes must update the OpenAPI contract and corresponding runtime/Desktop code together. Neither bootstrap tickets nor direct PSKs may appear in command arguments, startup reports, diagnostics, or non-secret config metadata.

RCPP providers are external control-plane and access-point authorities, not plugin capability providers. Provider IDs, access point IDs, environment public IDs, Desktop authorization tokens, bootstrap tickets, and direct connection fields must not be reused as plugin installation identities, plugin capability names, plugin broker grants, or plugin runtime leases. Plugins hosted inside Redeven should reach environment and business resources through Local UI session context, released ReDevPlugin brokers, and Redeven-registered adapters rather than by speaking RCPP provider endpoints directly.

# Evidence

- `redeven:spec/openapi/rcpp-v2.yaml:3` - The OpenAPI title names the Redeven Control Plane Provider Protocol.
- `redeven:okf/architecture/plugin-platform-integration.md:75` - RCPP provider credentials are adjacent host mechanisms, not plugin grant planes.
- `redeven:internal/config/state_paths.go:118` - Provider and access-point URL normalization requires a clean HTTPS origin.
- `redeven:internal/config/bootstrap.go:326` - Runtime bootstrap exchange constructs the ticket endpoint from the normalized access-point origin.

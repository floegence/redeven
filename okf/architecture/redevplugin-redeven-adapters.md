---
type: Architecture Boundary
title: ReDevPlugin Redeven adapters
tags: [architecture, plugins, adapters, ui]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Redeven owns only the adapters that bind authenticated product sessions, source policy, business capabilities, and Activity or Workbench placement to released ReDevPlugin contracts. ReDevPlugin remains the authority for host protocol, package trust, runtime execution, and platform state. Adapter failures stop at the product boundary and never create copied platform state or implicit grants.

# Contract

## Host modules and external packages
Redeven constructs the released Host with explicit core, official-release, runtime, connectivity, secrets, capability, and external-package modules. Redeven supplies session, authorization, web-security, trust, official release-source, observability, secret, external source, and business adapters; it never edits registry, inspection, token, lease, revoke-epoch, or plugin-data state directly.

The official signed-release module remains the stricter release-ref path.

## Surfaces and interaction ownership
The product Shell owns one released `PluginPlatformClient`, authenticated transport, and shared surface scope.

The application-method receiver (`surface.methods`) uses the same read authorization as opening and preparing its surface. The receiver registers, polls, and responds only within the platform-validated surface, gateway token, bridge channel, and frame generation. Registering a receiver grants no document write access: each intent invocation still passes its declared method effect, local policy, schema, and confirmation checks.

Redeven uses them for host placement behavior, never as identity, authorization, or permission evidence.

A recovery presentation may explain or retry the Host snapshot, but it is not a second open gate and owns no catch-up identity state machine.

## Web origin adapter

Redeven derives a plugin origin only from a trusted product entry origin and the released surface origin key. Local UI and AppServer route child requests to the released Web surface handler after removing parent credentials. Desktop, Gateway and Center own the product transport and origin routing; package assets, tickets and surface bridge semantics remain upstream-owned.

# Boundaries

These adapters map product identity and presentation into released ReDevPlugin APIs. Package and runtime ownership remains in [ReDevPlugin host integration boundary](redevplugin-boundary.md) and [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Delegates package signature and freshness assessment upstream.

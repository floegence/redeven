---
type: Architecture Boundary
title: ReDevPlugin Redeven adapters
description: Keep Redeven-specific host modules, external package policy, and surface projection separate from ReDevPlugin platform mechanics.
tags: [architecture, plugins, adapters, ui]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns only the adapters that bind authenticated product sessions, source policy, business capabilities, and Activity or Workbench placement to released ReDevPlugin contracts. ReDevPlugin remains the authority for host protocol, package trust, runtime execution, and platform state. Adapter failures stop at the product boundary and never create copied platform state or implicit grants.

# Contract

## Host modules and external packages
Redeven constructs the released Host with explicit core, official-release, runtime, connectivity, secrets, capability, and external-package modules. Redeven supplies session, authorization, web-security, trust, official release-source, observability, secret, external source, and business adapters; it never edits registry, inspection, token, lease, revoke-epoch, or plugin-data state directly.

The official signed-release module remains the stricter release-ref path.

## Surfaces and interaction ownership
The product Shell owns one released `PluginPlatformClient`, authenticated transport, and shared surface scope.

Redeven uses them for host placement behavior, never as identity, authorization, or permission evidence.

A recovery presentation may explain or retry the Host snapshot, but it is not a second open gate and owns no catch-up identity state machine.

# Boundaries

These adapters map product identity and presentation into released ReDevPlugin APIs. Package and runtime ownership remains in [ReDevPlugin host integration boundary](redevplugin-boundary.md) and [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:internal/redevpluginintegration/session_lifecycle.go:1` - Carries transient connection generation while Host owns durable teardown.

- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Delegates package signature and freshness assessment upstream.

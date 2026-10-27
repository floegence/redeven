---
type: Architecture Contract
title: Plugin surface recovery and permissions
description: Keep Env App plugin inventory, installation observation, permission finalization, and reconnect recovery on one released client scope.
tags: [architecture, plugins, ui, recovery]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App owns one authenticated plugin client, one shared scope, and one installation observer. ReDevPlugin remains the authority for inventory, Executions, Events, permissions, revocation, and runtime recovery. Closing or reconnecting a panel preserves the exact request identity and authoritative outcome; a product refresh never becomes a second mutation or recovery lifecycle.

# Contract

## Env App inventory and permissions
Env App owns one authenticated fetch adapter, one released client, one shared scope, and one placement coordinator. Every mutation carries its current management and applicable policy/revoke revisions; committed and unknown management outcomes rely on Host revocation followed by the SDK's scope teardown, then refresh state without a second slot-close path or blind mutation retry.

Generic review and confirmation copy names the exact permission id instead of substituting an official-plugin label.

# Boundaries

The Env App observer may present and localize released snapshots, but it cannot infer retryability, recreate a request, close a plugin slot, or start a worker. Placement and surface geometry remain owned by [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.

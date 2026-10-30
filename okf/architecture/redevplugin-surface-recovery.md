---
type: Architecture Contract
title: Plugin surface recovery and permissions
tags: [architecture, plugins, ui, recovery]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Env App owns one authenticated plugin client, one shared scope, and one installation observer. ReDevPlugin remains the authority for inventory, Executions, Events, permissions, revocation, and runtime recovery. Closing or reconnecting a panel preserves the exact request identity and authoritative outcome; a product refresh never becomes a second mutation or recovery lifecycle.

# Contract

## Env App inventory and permissions
Env App owns one authenticated fetch adapter, one released client, one shared scope, and one placement coordinator. Every mutation carries its current management and applicable policy/revoke revisions; committed and unknown management outcomes rely on Host revocation followed by the SDK's scope teardown, then refresh state without a second slot-close path or blind mutation retry.

Generic review and confirmation copy names the exact permission id instead of substituting an official-plugin label.

## User close and forced revocation

User close requests use the released surface request-close contract. A plugin may report unsaved work; Redeven presents one localized Floe confirmation and preserves the slot if canceled. Forced lifecycle invalidation still revokes without waiting for user consent. A successful request-close is recorded as already closed so subsequent placement disposal cannot send a second close.

Management teardown may preserve the product layout while the SDK clears the document to `about:blank`, removes same-origin authority and closes the bridge. An iframe remaining in the layout is not evidence of retained application authority; a fresh authorized slot is required before reopening.

# Boundaries

The Env App observer may present and localize released snapshots, but it cannot infer retryability, recreate a request, close a plugin slot, or start a worker. Placement and surface geometry remain owned by [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.

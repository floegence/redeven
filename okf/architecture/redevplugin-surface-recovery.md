---
type: Architecture Contract
title: Plugin surface recovery and permissions
tags: [architecture, plugins, ui, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App owns one authenticated plugin client, one shared scope, and one installation observer. ReDevPlugin remains the authority for inventory, Executions, Events, permissions, revocation, and runtime recovery. Closing or reconnecting a panel preserves the exact request identity and authoritative outcome; a product refresh never becomes a second mutation or recovery lifecycle.

# Contract

## Env App inventory and permissions
Env App owns one authenticated fetch adapter, one released client, one shared scope, and one placement coordinator. Every mutation carries its current management and applicable policy/revoke revisions; committed and unknown management outcomes rely on Host revocation followed by the SDK's scope teardown, then refresh state without a second slot-close path or blind mutation retry.

Generic review and confirmation copy names the exact permission id instead of substituting an official-plugin label.

## External lifecycle changes

Each surface's first terminal error refreshes the shared owner-scoped inventory
once. It does not replay an execution or automatically retry the same revision.
A user retry retires the failed slot, awaits an authoritative inventory read,
and opens only while the original component and authenticated owner remain
current. Failed reads never authorize reopening from a cached revision.

The product container's keyed lease owns replacement when management revision
or generation changes. The retired component cannot open a duplicate slot after
that replacement. Disabled plugins remain disabled; their explicit Enable
action first refreshes inventory and writes only if the current instance is
still disabled, using its current revision. If another client already enabled
it, the refreshed inventory restores the container without a second mutation.

Workbench and Activity use the same refresh callback. Shared inventory updates
Plugin Center as well as surface placement; refresh does not remove layout,
replay Agent/file writes, or revoke sibling surfaces. A failed inventory read
retains a healthy cached lease; it is not evidence of revocation. The failed
surface still requires a successful authoritative read before retrying.
The projection reads the resource's latest owner-bound snapshot during refresh
so background inventory requests never suspend and detach the Workbench DOM.
Detaching an iframe would reload its already-consumed entry ticket and destroy
otherwise valid sibling application state.

Visibility and theme/context delivery can race with SDK retirement or document
navigation. A synchronous delivery failure enters the same first-error path
for that exact slot, refreshes inventory once, and retires through the SDK. It
must not escape into the Workbench error boundary or close sibling placements.

## Installation-bound runtime recovery

Startup recovery results describe the exact Host-checked installation: instance
ID, active fingerprint, installation timestamp, and management revision. The
released SDK compares that identity with the current enabled inventory record.
Env App preserves those fields in both official and external inventory projections
and displays only matching observations. Updates, reinstalls, disabling, and
uninstalling invalidate an old observation without deriving readiness or starting
another recovery pass. A current failure on a sibling installation stays visible.

Explicit retry loading, success, failure, and rejected requests remain bound to
the installation and authenticated session captured when retry began. A delayed
response cannot overwrite a replacement installation. Product copy localizes the
released reason code; a catalog instance ID or a raw unknown code is not the
user-facing failure message. Inventory action state remains the launch authority.

## User close and forced revocation

When a narrow Plugin Center replaces a card with details to confirm uninstall,
dismissal returns focus to the surviving detail heading after modal presence
ends. The hidden card trigger is no longer a valid return destination.

User close requests use the released surface request-close contract. A plugin may report unsaved work; Redeven presents one localized Floe confirmation and preserves the slot if canceled. Forced lifecycle invalidation still revokes without waiting for user consent. A successful request-close is recorded as already closed so subsequent placement disposal cannot send a second close.

Management teardown may preserve the product layout while the SDK clears the document to `about:blank`, removes same-origin authority and closes the bridge. An iframe remaining in the layout is not evidence of retained application authority; a fresh authorized slot is required before reopening.

# Boundaries

The Env App observer may present and localize released snapshots, but it cannot infer retryability, recreate a request, close a plugin slot, or start a worker. Placement and surface geometry remain owned by [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.

- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.

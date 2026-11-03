---
type: Architecture Contract
title: Plugin surface recovery and permissions
tags: [architecture, plugins, ui, recovery]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Env App owns one authenticated plugin client, shared scope and installation observer. ReDevPlugin owns inventory, Executions, Events, permissions, revocation and recovery. Panel closure/reconnect retains exact request identity and outcome; refresh never becomes another mutation or lifecycle.

# Contract

## Inventory and permissions
One authenticated fetch adapter/client/scope/placement coordinator serves Env App. Mutations carry current management and applicable policy/revoke revisions. Committed/unknown outcomes use Host revocation then SDK scope teardown and refresh, never a second slot-close path or blind retry. Confirmation names exact permission IDs, not official-plugin labels.

## External changes
The first terminal error per surface refreshes owner-scoped inventory once, without execution replay or same-revision auto-retry. User Retry retires its failed slot, awaits authoritative inventory and opens only while original component/owner remain current. Failed reads never authorize cached-revision reopening.

The keyed lease replaces changed management revisions/generations; retired components cannot reopen duplicate slots. Enable first refreshes the instance, mutating its current revision only if still disabled. If already enabled elsewhere, refresh restores the container without another mutation.

Activity/Workbench share refresh with Plugin Center and placement. Refresh preserves layout, Agent/file effects and sibling surfaces. Failed reads retain healthy cached leases, not prove revocation; failed surfaces still need successful reads before retry. Refresh reads the latest owner-bound snapshot without suspending/detaching Workbench DOM: iframe detachment would reload consumed tickets and lose sibling state.

Synchronous visibility/theme/context delivery faults during retirement/navigation enter the same exact-slot first-error refresh/SDK retirement path. Never escape into Workbench's error boundary or close siblings.

## Installation recovery
Host startup observations bind instance ID, active fingerprint, installation timestamp and management revision. SDK compares current enabled inventory; both official/external projections preserve these fields and show only matches. Update/reinstall/disable/uninstall invalidates old observations without inferred readiness or another recovery pass; current sibling failures remain visible.

Explicit retry loading/results/rejections bind captured installation/authenticated session. Late replies cannot replace new installation state. Localize released reason codes; catalog instance IDs/raw unknown codes are not failure copy. Inventory action_state alone authorizes launch.

## Worker execution failures
Ordinary Worker budget, memory or deadline failures return to the application through released typed execution errors. They do not invalidate Surface authority, discard drafts or trigger replay. Authors own call-error presentation; host recovery handles terminal Surface failures only.

## Close and revocation
On narrow Plugin Center uninstall, return focus after modal exit to surviving detail heading, not hidden card. User close uses released request-close; unsaved work gets one localized Floe confirmation, preserving slot on cancel. Forced invalidation bypasses consent. Record successful request-close to prevent duplicate close on disposal.

SDK teardown may leave product layout while setting the document to about:blank, removing same-origin authority and closing bridge. Retained iframe geometry proves no application authority; reopening requires a fresh authorized slot.

# Boundaries

Observers present/localize released facts, never infer retryability, recreate requests, close slots or start workers. [Platform integration](plugin-platform-integration.md) owns placement/geometry.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Source.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Tests.

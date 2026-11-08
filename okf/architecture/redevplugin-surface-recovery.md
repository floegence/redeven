---
type: Architecture Contract
title: Plugin surface recovery and permissions
tags: [architecture, plugins, ui, recovery]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Env App owns one authenticated plugin client, shared scope and installation observer. Panel closure/reconnect retains exact request identity and outcome; refresh never becomes another mutation or lifecycle. First terminal surface error refreshes owner inventory once,never execution/same-revision auto-retry.

# Contract

## Inventory and revisions
One authenticated adapter/client/scope/placement coordinator. Mutations carry current management/policy/revoke revision. Committed/unknown uses Host revoke then SDK scope teardown/refresh,no second close/blind retry. Confirmation names exact permissionIDs.

User Retry retires failed slot,awaits authoritative inventory and reopens only current original owner/component. Changed revisions/generations replace keyed lease;retired owners cannot duplicate. Enable refreshes first and writes only if still disabled;already-enabled restores without mutation. Failed reads preserve healthy leases,never authorize failed-slot reopening.

Activity/Workbench/Center share refresh preserving layout/effects/siblings and mounted DOM;iframe detach reloads consumed tickets. Retirement/navigation delivery faults use exact-slot first-error path,never Workbench boundary/sibling close.

## Installation and execution
Startup observations bind instance/fingerprint/install timestamp/management revision;SDK displays matching enabled inventory only. Update/reinstall/disable/uninstall invalidates old observations,not inferred readiness/extra pass. Retry binds captured installation/session;late replies fenced. Localize reason codes,not IDs/unknown raw codes;inventory action_state alone authorizes launch.

Worker budget/memory/deadline errors belong to app,revoke no Surface,drafts or replay. Host recovery handles terminal Surface errors only.

## Close
Narrow uninstall restores focus after modal exit to surviving heading. request-close gives one localized unsaved confirmation,preserves slot on cancel;forced invalidation bypasses consent. Successful close suppresses duplicate disposal close. SDK may retain layout while blanking document/removing origin/bridge authority;geometry is no authority,fresh authorized slot required to reopen.

# Boundaries

Observers present/localize released facts, never infer retryability, recreate requests, close slots or start workers. [Platform integration](plugin-platform-integration.md) owns placement/geometry.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Source.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Tests.

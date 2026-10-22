---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through an accessible Launcher, searchable category discovery, exact inventory identities, explicit review, SDK-owned surfaces, Activity windows and pinned pages, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-10-12T00:00:00Z
quality_exception: Cross-surface discovery, navigation, permissions, and SDK surface presentation contract; installation, package review, and saved layout continuity are separate concepts.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns plugin navigation, discovery, management presentation, and placement;
released ReDevPlugin owns package admission, surface authority, confirmations,
bridge sessions, and revocation. Open uses the current mode with independent SDK
slots in Activity and Workbench. Saved canvas placement survives runtime cleanup;
[plugin layout continuity](plugin-layout-continuity.md) owns recovery and removal.
Unknown outcomes require authoritative reconciliation, never wider teardown or
blind retry. Management retains search and selection while exposing actionable
failures and current permissions.

# Contract

## Discovery and exact inventory
The Activity Bar `Plugins` entry opens a Shell-root Launcher without changing the current normal surface. Search normalizes Unicode with NFKC and locale-aware case folding, matches display name, canonical keywords, and the locale's explicit alias key, and intersects with the selected category.

On tablet and desktop, the detail drawer overlays the directory without resizing or reflowing the card grid; closing it restores focus to the originating row.

## Session recovery
After a direct-session handshake, the Shell requests the idempotent Host `recoverEnabled` snapshot on the explicit authenticated plugin-session-ready transition; it does not insert a stability timer. Cards, details, launchers, and placement commands consume the Host `action_state`; they do not derive `can_open` from trust, policy, grants, or recovery flags.

## Installation and package review
[Official installation progress](plugin-installation-progress.md) owns durable Execution observation and approved setup. Both workflows preserve the placement contract and never turn a failed operation into component deletion.

## Permissions and policy
Plugin Center joins installed records, active grants, Host permission requirements, and security policy.

Method effects never rename the capability being granted. Failure reloads inventory, grants, and policy and requires a new confirmation.

## Activity windows and pinned pages
Each Activity window owns one fresh `PluginSurfaceSlot` and opens it only through `openSurfaceInSlot`.

An opening or bridge failure replaces the iframe area with a recovery panel; timeouts explain that the plugin took too long and offer Retry.

Restart restores shortcuts but always begins on a built-in page, so startup does not automatically open third-party content.

## Workbench widgets and placement
[Plugin layout continuity](plugin-layout-continuity.md) owns saved binding, atomic placement, exact-instance removal, retry, conflict, and recovery behavior. Status overlays may isolate unavailable content but must not forward events, guess plugin focus, or establish another bridge. Unpinning removes only the shortcut.

## Confirmation and teardown
Surface capability confirmations use one abort-aware FIFO product dialog. Cancel owns initial focus, each request is decided independently, and hidden, retired, or revoked surfaces cannot approve queued work.

Retired Surfaces cannot start a download, and exported bytes are neither uploaded nor retained by the Shell.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic roles. Activity, Workbench, window, widget, inventory, navigation, settings, and layout are Redeven placement concepts and never manifest fields.

It does not verify packages or releases, mint tokens, serve assets, grant permissions implicitly, or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx` - Uses the published SDK and authenticated product placement adapter to verify WebGL 1/2 pixels, visibility, exact close, and reopening.

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.navigation.browser.test.tsx` - Verifies the published Dock order, trailing actions and saved pins, pointer activation, and keyboard activation.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Owns inventory, client lifetime, lifecycle commands, and cross-placement serialization.

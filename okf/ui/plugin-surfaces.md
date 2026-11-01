---
type: UI Contract
title: Plugin surfaces
tags: [ui, plugins, activity, workbench, plugin-center]
quality_exception: Cross-surface discovery, navigation, permissions, and SDK surface presentation contract; installation, package review, and saved layout continuity are separate concepts.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven owns plugin discovery, navigation and placement; released ReDevPlugin owns admission, surface authority, bridge sessions, confirmation and revocation. Activity and Workbench use independent SDK slots. Management preserves search/selection, exposes actionable failures and reconciles unknown outcomes against authoritative state.

# Contract

## Discovery and exact inventory
Activity Bar Plugins opens a Shell-root Launcher without changing the normal surface. Search intersects category with NFKC/locale-case-folded display names, canonical keywords and explicit locale aliases. Tablet/desktop details overlay the grid without reflow and restore originating-row focus.

## Session recovery
An authenticated session-ready transition invokes idempotent Host `recoverEnabled` without a stability timer. All placements consume Host `action_state`; trust, grants, policy or recovery flags cannot derive `can_open`.

## Installation and package review
[Installation progress](plugin-installation-progress.md) owns durable Execution observation and approved setup; [package review](plugin-package-review.md) owns external packages. Failures preserve placement rather than delete components.

## Permissions and policy
Plugin Center joins inventory, grants, Host requirements and policy. Method effects cannot rename granted capabilities. Failure reloads authority and requires a new confirmation.

## Activity windows and pinned pages
Each window creates one fresh `PluginSurfaceSlot` through `openSurfaceInSlot`. Opening/bridge failures replace the iframe with local recovery; timeouts explain delay and offer Retry. Restart restores shortcuts but starts on a built-in page, never automatically opens third-party content.

Reopening an existing Activity page with equivalent inventory metadata preserves its container, iframe and application state. Visibility changes use the existing slot lifecycle. A changed instance, surface, management revision or runtime generation still retires the old lease; revoked authority never survives for visual continuity. Cold opening immediately shows one host-themed accessible waiting surface, without rotating internal bootstrap-stage labels. Ready content replaces it; failures keep actionable recovery and diagnostic details.

Each pinned page runtime owns a stable registered component function. Inventory or pin updates may refresh names, icons and ordering without replacing other live page components. Removing or revoking one plugin must not recreate a sibling's iframe or discard its editing state.

The released Floe retained-view container owns sibling collection isolation and stable DOM order. Moving a retained iframe can reload its document even when the element identity survives, so acceptance checks the inner document and draft as well as the container. Redeven consumes the published implementation rather than copying a second keep-alive stack.

## Workbench widgets and placement
[Layout continuity](plugin-layout-continuity.md) owns saved bindings, atomic placement, exact removal and recovery. Status overlays cannot forward input, guess focus or create a second bridge. Unpin removes only the shortcut.

## Confirmation and teardown
One abort-aware FIFO dialog decides requests independently with initial Cancel focus. Hidden, retired or revoked surfaces cannot approve queued work. Retired surfaces cannot download; Shell neither uploads nor retains exported bytes.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic roles. Activity, Workbench, window, widget, inventory, navigation, settings, and layout are Redeven placement concepts and never manifest fields.

It does not verify packages or releases, mint tokens, serve assets, grant permissions implicitly, or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Inventory refresh and sibling removal retain the registered page component while presentation metadata updates.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceContinuity.test.tsx` - Equivalent target updates retain the live document; authority changes retire it.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.test.tsx` - Immediate, stable opening feedback and terminal recovery behavior.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx` - Published SDK/product placement: actual WebGL1/2 pixels, visibility, close/reopen.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Inventory/client/commands and cross-placement lifecycle serialization.

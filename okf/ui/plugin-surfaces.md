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

## Workbench widgets and placement
[Layout continuity](plugin-layout-continuity.md) owns saved bindings, atomic placement, exact removal and recovery. Status overlays cannot forward input, guess focus or create a second bridge. Unpin removes only the shortcut.

## Confirmation and teardown
One abort-aware FIFO dialog decides requests independently with initial Cancel focus. Hidden, retired or revoked surfaces cannot approve queued work. Retired surfaces cannot download; Shell neither uploads nor retains exported bytes.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic roles. Activity, Workbench, window, widget, inventory, navigation, settings, and layout are Redeven placement concepts and never manifest fields.

It does not verify packages or releases, mint tokens, serve assets, grant permissions implicitly, or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginWebGL.browser.test.tsx` - Published SDK/product placement: actual WebGL1/2 pixels, visibility, close/reopen.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Inventory/client/commands and cross-placement lifecycle serialization.

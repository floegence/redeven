---
type: Desktop Contract
title: Desktop shell theme state
description: Select global appearance, synchronize Desktop windows, and recover a failed theme change without losing workspace state.
tags: [desktop, themes, ui, electron]
timestamp: 2026-09-22T03:20:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven Desktop owns the global `system | light | dark` source and the remembered light and dark Floe presets. One validated snapshot drives Welcome, Env App, native chrome, and main-generated documents. New or reset selections use Porcelain Light and Porcelain Dark. Explicit valid choices survive upgrades. A user request paints pending feedback before asynchronous persistence; failure retains the acknowledged selection and permits retry. Theme changes preserve mounted content, drafts, and focus.

# Contract

## Catalog and authority
The shared Desktop contract derives admitted ids, defaults, and semantic metadata from the published Floe Webapp dependency's browser-neutral `/themes` entry. Redeven must not copy the palette or weaken the upstream high-contrast and forced-color behavior.

OS appearance updates change the active preset only while following the system.

## Renderer synchronization and switching
The preload reads the initial snapshot before composition. User-triggered writes use asynchronous IPC; they must not call synchronous IPC or block input while main is busy.

The [shared material contract](../ui/surface-material.md) remains independent of palette and theme IPC.

## Product hierarchy
Env App settings derive content, sidebar, panel, inset, divider, control, and selection roles from active Floe tokens. Classic presets do not own a second settings palette.

## Native chrome and auxiliary documents
Every native titlebar background comes from the published preview, and its symbol color from the semantic foreground, including Classic presets. Symbol contrast must remain at least 3:1.

Renderer IPC rejects semantic palettes; full renderers use Floe token CSS and Monaco definitions.

# Boundaries

All Floe dependencies resolve from public npm releases, without sibling checkouts, aliases, overlays, or runtime patches in formal validation. Renderers cannot persist a competing canonical selection, accept arbitrary colors, receive the main-only palette, or bypass snapshot validation.

Other declarations in that file and product styling remain subject to semantic-token checks, including Welcome shadows.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkThemeColorSources.mjs` - Exact path and declaration boundaries for published theme sources.

- `redeven:internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs` - Generated standalone stylesheet readback against the published dependency.

- `redeven:desktop/src/shared/desktopTheme.ts` - Published catalog admission, defaults, state keys, and snapshot contracts.

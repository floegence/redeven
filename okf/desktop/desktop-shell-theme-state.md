---
type: Desktop Contract
title: Desktop shell theme state
description: Select global appearance, synchronize Desktop windows, and recover a failed theme change without losing workspace state.
tags: [desktop, themes, ui, electron]
timestamp: 2026-09-19T00:00:00Z
---
# Summary

Redeven Desktop owns the global `system | light | dark` source and the remembered light and dark Floe presets. One validated snapshot drives Welcome, Env App, native chrome, and main-generated documents. New or reset selections use Porcelain Light and Porcelain Dark. Explicit valid choices survive upgrades. A user request paints pending feedback before asynchronous persistence; failure retains the acknowledged selection and permits retry. Theme changes preserve mounted content, drafts, and focus.

# Contract

## Catalog and authority

The shared Desktop contract derives admitted ids, defaults, and semantic metadata from published Floe Webapp v0.56.17's browser-neutral `/themes` entry. Its 26 presets include 12 light and 14 dark choices, with Porcelain first in each mode and the other presets retaining their published relative order. Porcelain Light uses warm ivory surfaces and dark ink. Porcelain Dark uses near-black backgrounds, charcoal surfaces, and warm white text. Its idle input edges are deliberately quiet; the shared focus border provides stronger interaction feedback. Redeven must not copy the palette or weaken the upstream high-contrast and forced-color behavior.

The selection schema remains version 1, persisted separately from the source key. Invalid versions, unknown ids, and cross-mode ids normalize independently to the upstream per-mode defaults. Valid stored selections, including Classic presets, remain unchanged.

`DesktopThemeState` resolves `system` through Electron `nativeTheme`, selects the remembered preset for that mode, and derives native colors and a versioned semantic fallback palette. Source and preset writes persist before replacing acknowledged state or broadcasting. A failed write leaves that state available for an exact retry. Invalid and unchanged updates have no persistence or broadcast side effects. OS appearance updates change the active preset only while following the system.

## Renderer synchronization and switching

The preload reads the initial snapshot before composition. User-triggered writes use asynchronous IPC; they must not call synchronous IPC or block input while main is busy. Every response and broadcast is validated before applying the resolved class, `color-scheme`, active-preset attribute, and fallback colors. A delayed response cannot overwrite a more recent broadcast.

Welcome and Env App storage adapters expose main-owned source and preset keys in Floe's public persistence shape. They ignore debounced renderer writes to those keys, preventing an older projected snapshot from becoming a new command. Removing owned keys resets the corresponding Desktop preference through the bridge. Unrelated keys retain the base adapter behavior. Renderer subscriptions batch updates through Floe's public theme service so token CSS and Monaco react once without remounting the workspace.

Both Appearance pickers retain separate mode and preset radiogroups. A preset changes the remembered choice for the displayed mode without forcing `system` to become explicit or resetting the other mode. Preview tiles use published preset metadata.

A click immediately marks the requested option busy and exposes a localized live status. The released `deferAfterPaint` schedules the actual update after feedback can paint. The pending option stays distinct from the acknowledged checked option. Duplicate writes are suppressed while pending; the rest of the app and the picker close action remain usable. Failure clears pending, retains the previous checked choice, and presents a retryable inline error, including when the picker was closed during the request. Keyboard navigation, Escape, focus restoration, and focused-preset replacement after an OS mode change remain supported.

Standalone Env App uses the same picker over Floe's public ThemeContext persistence. Desktop-embedded Env App delegates mutations to the Desktop bridge. Neither surface introduces a competing palette or state authority. The [shared material contract](../ui/surface-material.md) remains independent of palette and theme IPC.

## Product hierarchy

Env App settings derive content, sidebar, panel, inset, divider, control, and selection roles from active Floe tokens. Ordinary top-level sections use headings, spacing, and actions instead of enclosing cards; tables, choices, alerts, and controls own the visible content boundary. Dividers remain weaker than insets, which remain weaker than controls. Navigation selection combines a soft fill, stronger text, and one 3 px indicator. High Contrast Light restores explicit section boundaries, and forced colors use system roles. Classic presets do not own a second settings palette.

## Native chrome and auxiliary documents

Every native titlebar background comes from the published preview, and its symbol color from the semantic foreground, including Classic presets. Symbol contrast must remain at least 3:1. Same-mode preset changes still update native chrome.

Web Service windows share Desktop decorations and theme registration. Their trusted local toolbar has a 40 px draggable title row and 54 px navigation row matching the native background, with platform controls and safe areas preserved. The address surface uses a subtle fill and the published [input focus boundary](../ui/input-focus-boundaries.md). Main generates preset CSS from published metadata; its dedicated preload reads only validated theme and window-chrome snapshots. Switching selectors never reloads the toolbar or application, replaces an address draft, resets selection, or reclaims focus. Address drafts survive blur and background page updates until navigation, cancellation, or clearing. The toolbar does not expose the page bridge. Unavailable-service documents retain their main-owned refresh path.

The main-only semantic palette carries background, surface, muted surface, foreground, muted foreground, border, primary, primary foreground, and status roles under a validated version. Codespace loading documents receive the current snapshot and refresh from tracked loading state after a change. The blocked-startup builder accepts that projection and uses the published light default when none is supplied; it has no production realtime coordinator. Renderer IPC rejects semantic palettes; full renderers use Floe token CSS and Monaco definitions.

# Boundaries

All Floe dependencies resolve from public npm releases, without sibling checkouts, aliases, overlays, or runtime patches in formal validation. Renderers cannot persist a competing canonical selection, accept arbitrary colors, receive the main-only palette, or bypass snapshot validation. Welcome layering may derive from active tokens, but cannot restore fixed Classic colors that erase preset differences.

# Evidence

- `redeven:desktop/src/shared/desktopTheme.ts` - Published catalog admission, defaults, state keys, and snapshot contracts.
- `redeven:desktop/src/main/desktopThemeState.ts` - Persistence, OS following, remembered selections, and window broadcasts.
- `redeven:desktop/src/main/desktopThemeState.test.ts` - Defaults, retained choices, failed-write retry, and multi-window state.
- `redeven:desktop/src/main/desktopTheme.ts` - Native colors and main-only palette projections.
- `redeven:desktop/src/shared/desktopThemeIPC.ts` - Narrow IPC snapshot validation.
- `redeven:desktop/src/preload/windowTheme.ts` - Initial paint, asynchronous mutation, and broadcast authority.
- `redeven:desktop/src/preload/windowTheme.test.ts` - Pending writes, invalid responses, and delayed-response ordering.
- `redeven:desktop/src/welcome/desktopTheme.ts` - Read projection and suppression of delayed persistence commands.
- `redeven:desktop/src/welcome/DesktopThemePicker.tsx` - Pending presentation, published previews, keyboard and error handling.
- `redeven:desktop/scripts/check-appearance-electron.mjs` - Isolated real Electron acceptance with delayed writes, two windows, and retained drafts.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppThemePicker.test.tsx` - Env App pending feedback, repeat-click suppression, failure, and focus behavior.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppThemePicker.browser.test.tsx` - Visible pending feedback and retained editing state with the published theme provider.
- `redeven:internal/envapp/ui_src/src/styles/settingsThemeHierarchyVisual.browser.test.tsx` - Settings hierarchy and contrast across published presets.
- `redeven:desktop/src/build/test/webServiceBrowserRuntime.ts` - Native Web Service chrome and uninterrupted address drafts.

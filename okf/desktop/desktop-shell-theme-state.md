---
type: Desktop Contract
title: Desktop shell theme state
description: Desktop owns global theme source, per-mode shell presets, renderer synchronization, and native window colors.
tags: [desktop, themes, ui, electron]
timestamp: 2026-07-21T00:00:00Z
---
# Summary

Redeven Desktop is the single authority for the global `system | light | dark` source and the remembered light and dark Floe shell presets. One validated snapshot drives Welcome, every open Env App renderer, Floe shell tokens, Monaco, and Electron window chrome without allowing renderers to introduce arbitrary preset ids or colors.

# Contract

## Mechanism

The shared Desktop catalog admits exactly the 22 shell preset ids published by Floe Webapp v0.39.0, split into 11 light and 11 dark presets. Classic Light and Classic Dark remain the per-mode defaults. The versioned selection persists separately from the existing source key, and invalid versions, unknown ids, or cross-mode ids normalize to the corresponding Classic preset without blocking startup.

`DesktopThemeState` owns the source and both remembered presets. It resolves the active mode from Electron `nativeTheme` only while the source is `system`, selects the remembered preset for that mode, derives the matching native window colors, and broadcasts one immutable snapshot to every registered window. Source and preset updates are validated in the main process; no-op or invalid updates return the current snapshot without redundant persistence or broadcast. An operating-system appearance change swaps to the other remembered preset only while system following is active.

The preload bridge exposes snapshot read, source update, preset update, and subscription operations. It validates every main-process snapshot before applying the resolved light/dark class, `color-scheme`, active preset data attribute, and document fallback colors. Welcome and Env App storage adapters intercept the Floe source and shell-preset keys and project the main-process snapshot into Floe's public persistence shape. Renderer subscriptions update Floe through its public theme service so token CSS and mounted Monaco editors react without direct localStorage or ad-hoc CSS mutation.

Welcome exposes one anchored Appearance picker. Its mode radiogroup changes the global source, while selecting a theme updates the remembered preset for the currently displayed mode without forcing `system` to become explicit. Preview tiles use each upstream preset's own background, sidebar, surface, border, primary, and representative colors. Env App does not own a second picker; it follows the same Desktop snapshot and retains existing mode shortcuts without resetting either remembered preset.

Native titlebar colors are catalogued per admitted preset. Each background matches the upstream preset preview background, the symbol color matches its reviewed foreground, and the pair must maintain at least 3:1 contrast. Changing a preset reapplies Electron window chrome even when the resolved light/dark mode is unchanged.

# Boundaries

Renderers do not persist a competing canonical selection, accept arbitrary colors, or bypass the validated main-process snapshot. Redeven does not fork Floe's shell token maps or Monaco theme definitions, and package manifests and lockfiles must resolve Floe Webapp v0.39.0 from the public npm registry rather than a sibling checkout, workspace, link, alias, or runtime patch. Welcome-specific visual layering may derive from active semantic tokens, but must not restore Classic-only literal surface or border colors that flatten preset differences.

# Evidence

- `redeven:desktop/src/shared/desktopTheme.ts:5` - The shared contract enumerates 11 light and 11 dark ids, defaults, state keys, and snapshot validation.
- `redeven:desktop/src/main/desktopThemeState.ts:29` - Main resolves the active preset and native window snapshot from source and remembered selections.
- `redeven:desktop/src/main/desktopTheme.ts:13` - The native titlebar catalog maps every admitted preset to reviewed background and symbol colors.
- `redeven:desktop/src/main/desktopTheme.test.ts:43` - Contract tests compare the native catalog with the published Floe preset catalog and verify titlebar contrast.
- `redeven:desktop/src/shared/desktopThemeIPC.ts:7` - IPC defines snapshot, source, preset-update, and broadcast channels with strict snapshot normalization.
- `redeven:desktop/src/preload/windowTheme.ts:85` - Preload applies the validated active preset and resolved mode before renderer composition.
- `redeven:desktop/src/welcome/desktopTheme.ts:122` - Welcome projects the Desktop snapshot through Floe source and shell-preset storage keys.
- `redeven:desktop/src/welcome/DesktopThemePicker.tsx:108` - Appearance previews render directly from each upstream preset's preview metadata.
- `redeven:internal/envapp/ui_src/src/ui/App.tsx:62` - Env App configures published shell presets and synchronizes the mounted Floe theme service.
- `redeven:desktop/package.json:60` - Desktop consumes published Floe Webapp Core v0.39.0.
- `redeven:internal/envapp/ui_src/package.json:22` - Env App consumes published Floe Webapp Boot, Core, and Protocol v0.39.0.

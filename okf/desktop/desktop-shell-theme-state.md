---
type: Desktop Contract
title: Desktop shell theme state
description: Select global appearance, synchronize Desktop windows, and recover a failed theme change without losing workspace state.
tags: [desktop, themes, ui, electron]
timestamp: 2026-09-22T03:20:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Desktop owns global `system | light | dark` mode and remembered Floe light/dark presets. One validated snapshot drives Welcome, Env App, native chrome and generated documents. New/reset selections use Porcelain Light/Dark; valid choices survive upgrades. User changes paint pending feedback before asynchronous persistence, retain acknowledged state on failure and permit retry without losing mounted content, drafts or focus.

# Contract

- Admit ids/defaults/metadata from published Floe `/themes`; never copy palettes or weaken forced-color/high-contrast behavior. OS changes apply only in system mode.
- Preload supplies the initial snapshot; user writes use asynchronous IPC without blocking input. [Surface material](../ui/surface-material.md) remains independent.
- Settings derive content, panels, insets, dividers, controls and selections from active tokens, including Classic presets.
- Welcome and Env App theme popovers begin with one localized, single-line Theme heading. Omit the selected-preset subtitle and visible color-mode caption; keep the color-mode radiogroup accessibly named. Inline settings retain their visible mode label.
- Native chrome uses published preview background and semantic foreground with at least 3:1 symbol contrast. Renderers reject palette-bearing IPC and use Floe CSS/Monaco definitions.

# Boundaries

Resolve public npm dependencies without sibling wiring/patches. Renderer storage cannot become canonical, accept arbitrary colors, receive main-only palettes or bypass validation. Product styling, including Welcome shadows, remains subject to theme-source checks.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkThemeColorSources.mjs` - Exact path and declaration boundaries for published theme sources.

- `redeven:internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs` - Generated standalone stylesheet readback against the published dependency.

---
type: Desktop Contract
title: Desktop shell theme state
tags: [desktop, themes, ui, electron]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

One validated Desktop theme snapshot drives Welcome, Env App, chrome and generated documents. New/reset themes use Porcelain; valid choices survive upgrades. Selection paints before persistence, retaining acknowledged state, drafts/focus/content and Retry on failure.

# Contract

- Admit ids/defaults/metadata from published Floe `/themes`; never copy palettes or weaken forced-color/high-contrast behavior. OS changes apply only in system mode.
- Preload supplies the initial snapshot; user writes use asynchronous IPC without blocking input. [Surface material](../ui/surface-material.md) remains independent.
- Settings derive content, panels, insets, dividers, controls and selections from active tokens, including Classic presets.
- Welcome and Env App theme popovers begin with one localized, single-line Theme heading. Omit the selected-preset subtitle and visible color-mode caption; keep the color-mode radiogroup accessibly named. Inline settings retain their visible mode label.
- Native chrome uses published preview background and semantic foreground with at least 3:1 symbol contrast. Renderers reject palette-bearing IPC and use Floe CSS/Monaco definitions.

# Boundaries

Resolve public npm dependencies without sibling wiring/patches. Renderer storage cannot become canonical, accept arbitrary colors, receive main-only palettes or bypass validation. Product styling, including Welcome shadows, remains subject to theme-source checks.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkThemeColorSources.mjs` - Source.
- `redeven:internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs` - Source.

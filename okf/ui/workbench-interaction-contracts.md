---
type: UI Contract
title: Workbench interaction contracts
tags: [ui, workbench, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

This is the navigation point for explicit Workbench input and surface ownership. Focused concepts define wheel, pointer, text, terminal, selection, recovery, loading and overlays. Keep those responsibilities distinct rather than introducing widget-specific event heuristics.

# Contract

## Mechanism
- [Workbench surface lifecycle](workbench-surface-lifecycle.md)

# Boundaries

Workbench widgets must not infer canvas, input, recovery, focus, or overlay ownership from incidental DOM structure. Published Floeterm and floe-webapp contracts remain upstream authorities for their generic behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Tests.

---
type: UI Contract
title: Workbench interaction contracts
description: Canonical navigation for Workbench input and surface-lifecycle ownership.
tags: [ui, workbench, interaction, accessibility]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Workbench interaction is governed by explicit ownership contracts rather than widget-specific event heuristics. This overview is the canonical navigation point for input ownership and surface lifecycle. Focused concepts define wheel, pointer, text, terminal, selection, recovery, lazy loading, and shared overlay behavior without mixing those independent responsibilities into one retrieval unit.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [Workbench input ownership](workbench-input-ownership.md)
- [Workbench terminal interaction](workbench-terminal-interaction.md)

- [Workbench surface lifecycle](workbench-surface-lifecycle.md)

# Boundaries

Workbench widgets must not infer canvas, input, recovery, focus, or overlay ownership from incidental DOM structure. Published Floeterm and floe-webapp contracts remain upstream authorities for their generic behavior.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/workbenchWheelInteractive.ts:1` - Wheel ownership uses a dedicated data attribute.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2806` - Tests cover reusing a singleton widget without implicit ensureWidget centering when focus is disabled.

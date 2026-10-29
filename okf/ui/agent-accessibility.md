---
type: Interaction Contract
title: Product accessibility for AI agents
tags: [ui, accessibility, computer-use, workbench]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns names, descriptions, state and relationships while preserving geometry/styles/handlers/focus and hidden/inert exclusion. Published Floe owns reusable controls/focus/layers. Shared gaps require source/behavior evidence and released upstream fixes. Report audit scope accurately; accessibility changes alone certify neither full WCAG nor model performance.

# Contract

## Product semantics and unchanged interaction
Flower composer fields expose explicit localized names in both ordinary and private-input forms. Existing thread status, controls, menus, live announcements and collapsed/inactive view boundaries remain authoritative.

Adding roles must not claim keyboard behavior that a surface does not implement.

# Boundaries

## Shared gap decision and audit evidence
The audit of published floe-webapp 0.86.25 established that its Tabs item API exposed no per-tab DOM identity or controlled-panel target. TabPanel accepts `labelledBy`, but consumers cannot supply a corresponding tab identity through the public Tabs API.

Tests that deliberately filter cases qualify only the cases executed, never the whole product or platform matrix.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - existing path guidance and per-instance description association.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - composer names and existing hidden/inert interaction boundaries.

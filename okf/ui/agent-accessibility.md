---
type: Interaction Contract
title: Product accessibility for AI agents
description: Audit core product semantics while preserving visual presentation and existing input ownership.
tags: [ui, accessibility, computer-use, workbench]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns product names, descriptions, business state and relationships for
Flower, Welcome, files, terminal and Workbench. Accessibility additions preserve
existing classes, dimensions, colors, spacing, animations, event handlers and
focus recovery. Hidden/inert views remain excluded. General controls and shared
focus/floating mechanisms belong to published floe-webapp packages. A shared gap
requires source and behavior evidence before any upstream work; Redeven consumes
only a released upstream version. Failed audits report their exact scope and
cannot be presented as full WCAG or model-performance qualification.

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

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - semantic terminal viewport and history controls.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - composer names and existing hidden/inert interaction boundaries.

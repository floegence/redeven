---
type: UI Contract
title: Whole-window status surfaces
description: Present environment recovery, access gates, and standalone Desktop availability without applying glass to movable content.
tags: [ui, desktop, accessibility, workbench]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns window layout/artwork/retry/shimmer; Redeven maps actual connection/access/Desktop state. Recovery/access uses opaque neutral backgrounds over retained inert workspace, without duplicate disconnect notices. Floating windows, widgets and drag content exclude this material. Preserve recovery owner/actions; appearance grants no access or second loop.

# Contract

## Placement and state ownership
Environment recovery mounts outside the Workbench canvas and its transformed widgets.

The document never receives Runtime credentials or user draft contents.

Status styling is never injected into third-party application documents.

## Visual and accessibility behavior
Use the published `window-status.css` slots and browser-neutral `window-status` artwork entry.

Published shimmer supports reduced motion and forced colors; long translated copy and technical details must remain readable without horizontal scrolling.

A whole-window layout must not become a shared fallback for components that can be moved onto a canvas.

# Boundaries

Whole-window recovery, standalone documents, and access gates stay opaque; draggable surfaces do not inherit this material. Appearance neither grants authority nor introduces another recovery owner.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/reconnect/ConnectionRecoveryView.tsx` — Host recovery placement and real retry/stop actions.

- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.browser.test.tsx` — Locale, geometry, opaque backdrop and keyboard form acceptance.

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

Floe owns the shared whole-window layout, static artwork, retry geometry and progress shimmer. Redeven maps real connection, access and Desktop states to those published primitives. Recovery and access gates use an opaque neutral theme background even when the underlying workspace remains mounted and inert; no second disconnect notice may show through. Floating windows, Workbench widgets and draggable content never receive this material. Failure retains the existing recovery owner and explicit actions; appearance never grants access or starts another recovery loop.

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

- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.tsx` — Product access-state presentation.

- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.browser.test.tsx` — Locale, geometry, opaque backdrop and keyboard form acceptance.

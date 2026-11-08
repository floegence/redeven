---
type: UI Contract
title: Whole-window status surfaces
tags: [ui, desktop, accessibility, workbench]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns window layout/retry/artwork; Redeven maps actual access/connection state. The document never receives Runtime credentials or user draft contents. Status styling is never injected into third-party application documents. Published shimmer supports reduced motion and forced colors; long translated copy and technical details must remain readable without horizontal scrolling.

# Contract

## Placement and state ownership
Environment recovery mounts outside the Workbench canvas and its transformed widgets.

## Visual and accessibility behavior
Use the published `window-status.css` slots and browser-neutral `window-status` artwork entry.

A whole-window layout must not become a shared fallback for components that can be moved onto a canvas.

# Boundaries

Whole-window recovery, standalone documents, and access gates stay opaque; draggable surfaces do not inherit this material. Appearance neither grants authority nor introduces another recovery owner.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/reconnect/ConnectionRecoveryView.tsx`
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.browser.test.tsx`

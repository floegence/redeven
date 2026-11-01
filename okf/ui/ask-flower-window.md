---
type: UI Contract
title: Ask Flower window boundaries
tags: [ui, flower, floating-windows, desktop]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven places Ask Flower in Activity, Workbench and Welcome beneath visible Shell/native chrome. Header/composer stay reachable during drag and resize; maximize and titlebar double-click are unavailable. Floe constrains shrinking viewports while retaining the same composer, draft and interaction state.

# Contract

## Host boundary
The host adapter measures the visible Shell header's client-space bottom edge and takes the larger of that edge and the current Desktop titlebar safe area.

The host boundary and margin feed one published `viewportInsets` geometry path for anchored opening, centered opening, dragging, edge resizing, and viewport changes.

## Controls and constrained space
Ask Flower sets the published `FloatingWindow.maximizable` capability to false.

When it cannot accommodate the preferred size, the window shrinks within that viewport.

Other outside-click dismissal remains unchanged.

# Boundaries

Redeven supplies the Ask Flower placement policy and host measurements; published Floe owns dragging, resizing, clamping, and maximize controls. Host insets must not be duplicated in an alternate drag controller. These constraints apply to the contextual launcher, not the main Flower surface or other floating windows.

# Evidence

- `redeven:desktop/src/shared/askFlowerWindowViewport.tsx` - Host header measurement and native chrome subscription.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.tsx` - Env App host integration.

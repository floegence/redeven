---
type: UI Contract
title: Input focus boundaries
description: Identify one stable input boundary and consume the released Floe focus rule across product surfaces.
tags: [ui, desktop, flower, accessibility, focus]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published floe-webapp owns input focus presentation. Redeven supplies product
layout, semantic state, and one declared boundary for custom compound inputs.
Focus changes only the existing border color; geometry and decorative shadows
stay stable. Conflicting host styles fail source or browser checks and must be
removed at their owner. No fallback stylesheet overrides the released contract.

# Contract

## One visible boundary
Ordinary inputs, textareas, and native selects consume Floe's default rule. Focus never changes border width, padding, or dimensions.

Buttons, links, checkboxes, and switches retain their distinct keyboard focus indicators; a button inside an input boundary follows the upstream compound-control treatment.

## Published ownership
Desktop Welcome, Env App, and Flower consume the same released Floe dependency. Product selectors may define normal and hover appearance but must not override Floe's input focus state. It does not copy CSS rules or load the full renderer stylesheet into that document.

# Boundaries

Third-party frames, separate application views, and editor-internal input carriers retain their own published integration boundaries. This presentation contract changes no IPC, persistence, authentication, or navigation authority.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published Floe dependency and source-policy checks.

- `redeven:internal/envapp/ui_src/scripts/checkInputFocusSources.mjs` - Input-aware utility and CSS checks, preserving non-input focus rules.

- `redeven:internal/envapp/ui_src/src/styles/inputFocusVisual.browser.test.tsx` - All shell themes, compound controls, readonly, disabled, invalid, and forced-color behavior.

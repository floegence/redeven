---
type: UI Contract
title: Input focus boundaries
description: Identify one stable input boundary and consume the released Floe focus rule across product surfaces.
tags: [ui, desktop, flower, accessibility, focus]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

Published floe-webapp owns input focus presentation. Redeven supplies product
layout, semantic state, and one declared boundary for custom compound inputs.
Focus changes only the existing border color; geometry and decorative shadows
stay stable. Conflicting host styles fail source or browser checks and must be
removed at their owner. No fallback stylesheet overrides the released contract.

# Contract

## One visible boundary

Ordinary inputs, textareas, and native selects consume Floe's default rule.
Compound controls declare `data-floe-input-surface` on their existing visible
boundary. Their inner editors remain frameless, including chat composers,
search fields, path editing, and fields with prefixes or suffixes. Focus within
that boundary changes its border color without an additional outline, ring,
spaced contour, glow, background change, or focus shadow. Focus never changes
border width, padding, or dimensions. Underlined inputs retain their underline.

Errors use `aria-invalid` and preserve error color. Disabled controls cannot
acquire an interactive focus appearance. Readonly inputs remain focusable.
Forced colors use the upstream system border color. Buttons, links, checkboxes,
and switches retain their distinct keyboard focus indicators; a button inside
an input boundary follows the upstream compound-control treatment.

## Published ownership

Desktop Welcome, Env App, and Flower consume the same released Floe dependency.
Product selectors may define normal and hover appearance but must not override
Floe's input focus state. Trusted scriptless Web Service chrome embeds the
published `@floegence/floe-webapp-core/input-focus.css` asset and maps its theme
variables to the existing Desktop palette. It does not copy CSS rules or load
the full renderer stylesheet into that document.

# Boundaries

Third-party frames, separate application views, and editor-internal input
carriers retain their own published integration boundaries. Redeven does not
inject global styles into those surfaces. This presentation contract changes no
IPC, persistence, authentication, or navigation authority.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published Floe dependency and source-policy checks.
- `redeven:internal/envapp/ui_src/scripts/checkInputFocusSources.mjs` - Input-aware utility and CSS checks, preserving non-input focus rules.
- `redeven:internal/envapp/ui_src/src/styles/inputFocusVisual.browser.test.tsx` - All shell themes, compound controls, readonly, disabled, invalid, and forced-color behavior.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Product-owned search and path boundary declarations.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Frameless chat editing within a declared composer boundary.
- `redeven:desktop/src/main/webServiceBrowserDocument.ts` - Published standalone CSS in trusted chrome only.

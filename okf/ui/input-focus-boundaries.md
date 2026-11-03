---
type: UI Contract
title: Input focus boundaries
tags: [ui, desktop, flower, accessibility, focus]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published Floe owns focus presentation; Redeven supplies layout, semantic state and explicit compound-input boundaries. Focus changes border color only, preserving geometry/shadows. Fix conflicting styles at their owner with source/browser checks; no fallback stylesheet.

# Contract

## One visible boundary
Ordinary inputs, textareas, and native selects consume Floe's default rule. Focus never changes border width, padding, or dimensions.

Buttons, links, checkboxes, and switches retain their distinct keyboard focus indicators; a button inside an input boundary follows the upstream compound-control treatment.

## Published ownership
Desktop Welcome, Env App, and Flower consume the same released Floe dependency. Product selectors may define normal and hover appearance but must not override Floe's input focus state. It does not copy CSS rules or load the full renderer stylesheet into that document.

# Boundaries

Third-party frames, separate application views, and editor-internal input carriers retain their own published integration boundaries. This presentation contract changes no IPC, persistence, authentication, or navigation authority.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Source.
- `redeven:internal/envapp/ui_src/src/styles/inputFocusVisual.browser.test.tsx` - Tests.

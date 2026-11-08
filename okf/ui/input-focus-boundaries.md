---
type: UI Contract
title: Input focus boundaries
tags: [ui, desktop, flower, accessibility, focus]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published Floe owns focus presentation; Redeven supplies layout, semantic state and explicit compound-input boundaries. Buttons, links, checkboxes, and switches retain their distinct keyboard focus indicators; buttons inside an input boundary follow the upstream compound-control treatment.

# Contract

## One visible boundary
Ordinary inputs, textareas, and native selects consume Floe's default rule. Focus never changes border width, padding, or dimensions.

Flower's lightweight permission trigger deliberately stays transparent and marks keyboard focus with a label underline instead of a filled capsule.

Flower's transcript viewport retains keyboard focus for scrolling and its context menu, but paints no outer focus outline or shadow: the clipped scroll boundary must not turn Floe's generic focus ring into a horizontal line above the composer. This exemption belongs only to the transcript viewport; its interactive descendants retain their keyboard indicators.

## Published ownership
Desktop Welcome, Env App, and Flower consume the same released Floe dependency. Product selectors may define normal and hover appearance without duplicating Floe's focus rules. Flower's persistent chat composer maps the published `--floe-input-focus-color` token to its existing field edge, keeping focus handoffs and thread switches visually quiet, including forced colors. Approval and input-request fields retain their ordinary focus behavior. It does not copy CSS rules or load the full renderer stylesheet into that document.

# Boundaries

Third-party frames, separate application views, and editor-internal input carriers retain their own published integration boundaries. This presentation contract changes no IPC, persistence, authentication, or navigation authority.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Source.
- `redeven:internal/envapp/ui_src/src/styles/inputFocusVisual.browser.test.tsx` - Tests.

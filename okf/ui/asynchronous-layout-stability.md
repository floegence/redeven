---
type: UI Contract
title: Asynchronous layout stability
tags: [ui, accessibility, layout]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns geometry; Redeven localized feedback. Async request/copy/refresh/media completion never pushes neighbors or reserves empty rows. Blocking errors stay visible; retained-content errors use disclosure. Only user navigation/disclosure/new records may change layout.

# Contract

## Controls and feedback
Use the published Button loading slot and `icon` property. Controls which change text use the published `StableText` with every applicable localized transient label, including completion and failure.

Host application preparation has an independently scrollable body and persistent action baseline.

## Media and enhancement
Unknown block image dimensions use a bounded 16:9 viewport with contain sizing. Long diagrams and rendering errors stay scrollable inside their reserved viewport.

# Boundaries

## Acceptance
Normal-state acceptance measures the top of actual content, including both charts and the session table, so empty feedback lanes or leftover margins cannot pass merely by remaining stable. Validation consumes published dependencies without source aliases or local overlays.

# Evidence

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationAppearance.browser.test.tsx` - Tests.

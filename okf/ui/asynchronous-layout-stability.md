---
type: UI Contract
title: Asynchronous layout stability
description: Keep controls and retained content stationary through pending work, feedback, and media decoding.
tags: [ui, accessibility, layout]
timestamp: 2026-09-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns reusable control geometry; Redeven owns the localized states and feedback placement of its product surfaces. Starting or finishing a request, copying a value, refreshing retained data, and decoding media must not push adjacent controls or content. Normal views stay compact without empty feedback rows. Blocking errors remain visible, and retained-content errors remain accessible through a compact disclosure in an existing action row. User navigation, explicit disclosure, and newly added records may change layout; asynchronous feedback must not simulate those actions.

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

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationAppearance.browser.test.tsx` - Standalone application controls keep localized labels on one line across Chromium, Firefox, and WebKit.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.browser.test.tsx` - Card action alignment and complete localized labels through startup and editor preparation.

- `redeven:internal/envapp/ui_src/src/ui/widgets/RuntimeMonitorDensity.browser.test.tsx` - Compact chart and active-session table positions.

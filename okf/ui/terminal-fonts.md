---
type: UI Contract
title: Terminal fonts across client devices
description: Resolve bundled and locally available terminal fonts without changing another client's shared preferences or terminal grid.
tags: [ui, terminal, fonts, activity, workbench, desktop]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Env App owns terminal font selection and document-local loading. New preferences use bundled JetBrains Mono at the existing default size of 12; existing font IDs and sizes remain intact. Each client resolves its own available font, while Floeterm owns character cells, cursor positions, and the authoritative session grid. A missing saved font falls back visibly without rewriting that preference. Font loading failure keeps the terminal usable in system monospace and offers an explicit retry.

# Contract

## One font resolver for every terminal surface
Activity, Workbench, container exec, and settings previews consume the same font catalog and resolution result.

The menu separates bundled fonts from available local fonts and exposes the saved selection through accessible pressed state; an unavailable saved selection remains visible but cannot be newly selected.

No fallback changes a persisted preference.

## Preferences and shared terminal geometry
Activity preferences stay on the client. Unknown saved IDs are retained and resolved through the same visible fallback; no protocol or storage-field migration is introduced.

Existing clipping and navigation apply when the canonical grid does not fit the local viewport.

## Settings presentation
Terminal settings start with the actual resolved font and current theme preview. Narrow galleries retain one readable card column, including at 320px and 200% zoom.

# Boundaries

Font files and menu behavior are Runtime-served Env App assets. Updating Desktop alone cannot deploy them to an unchanged remote Runtime.

Quick CI and the final pre-push gate use the same Floeterm dependency consistency check, including the published npm integrity and Go checksums.

# Evidence

- `redeven:scripts/check_floeterm_dependency_consistency.mjs` - Published Go/npm release parity shared by Quick CI and final integration.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalFonts.ts` - Client-local loading, stable candidate IDs, and side-effect-free resolution.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalFontAssets.ts` - Packaged WOFF2 faces and Unicode ranges.

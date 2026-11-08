---
type: UI Contract
title: Terminal fonts across client devices
tags: [ui, terminal, fonts, activity, workbench, desktop]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App owns document-local terminal fonts. New preferences use bundled JetBrains Mono at size 12; existing IDs/sizes remain unchanged and each client resolves availability. The menu separates bundled fonts from available local fonts and exposes the saved selection through accessible pressed state; an unavailable saved selection remains visible but cannot be newly selected.

# Contract

## One font resolver for every terminal surface
Activity, Workbench, container exec, and settings previews consume the same font catalog and resolution result.

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

- `redeven:scripts/check_floeterm_dependency_consistency.mjs` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalFonts.ts` - Source.

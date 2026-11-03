---
type: UI Contract
title: Env App document reload presentation
tags: [ui, desktop, startup, caching]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns the anonymous reload geometry placeholder; Redeven hands it to current Activity inventory. Never replace restored content with a blank or mismatched skeleton. Geometry grants no data/authority. Denial, navigation, errors or auth change end it, and unavailable storage cannot block startup.

# Contract

## First paint
The HTML head installs Floe's independent `reload-placeholder` entry before external application modules and styles. It never serializes HTML, resource text, image sources, input values, URLs, or permission facts.

No resource count is invented in this pre-module surface.

## One handoff
[Page loading continuity](page-loading-continuity.md) owns the shared page registry used by Activity, Workbench, and reload eligibility.

Fresh authoritative resource changes may legitimately change the final layout.

Activity target selection remains owned by [Activity navigation restoration](activity-navigation-restoration.md).

# Boundaries

Remembered geometry conveys neither resource data nor authority. Storage unavailability cannot prevent startup or conceal the recovery state.

# Evidence

- `redeven:internal/envapp/ui_src/index.html` - Source.
- `redeven:internal/envapp/ui_src/src/ui/services/envReloadPresentation.ts` - Source.

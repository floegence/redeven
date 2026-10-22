---
type: UI Contract
title: Env App document reload presentation
description: Bridge document reload before modules execute and hand off once to the selected authorized inventory.
tags: [ui, desktop, startup, caching]
timestamp: 2026-09-23T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe owns the anonymous geometry placeholder spanning a full document
reload. Redeven's Shell owns its handoff to the selected Activity inventory.
Reload must not paint an empty root, reveal a differently shaped list skeleton,
or replace restored content with another loading state. Geometry is never
resource data or authorization. Explicit access denial, navigation, an actionable
error, or changed authentication ends the placeholder instead of hiding recovery.
Unavailable presentation storage must not prevent normal startup.

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

- `redeven:internal/envapp/ui_src/index.html` - Static first-visit surface.

- `redeven:internal/envapp/ui_src/vite.config.ts` - Published early bootstrap injection.

- `redeven:internal/envapp/ui_src/src/ui/services/envReloadPresentation.ts` - Single Shell handoff and revocation boundaries.

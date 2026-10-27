---
type: AI Configuration Contract
title: Model directory and selection
description: Runtime metadata and explicit selection.
tags: [ai, models, providers, settings]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Runtime owns atomic metadata. Reads/send preflight use shipped/saved snapshots; refresh never blocks configured chat. Background refresh is disclosed, opt-in and excludes OpenRouter. OpenRouter/Ollama discover on addition; manual refresh remains available.

# Contract

Runtime uses `runtime/model-catalog` and resolves shipped defaults on read. Unreviewed models require configuration. Cloud uses its catalog protocol without dispatch-time discovery.

Profiles separate selection, overrides, custom definitions and default identity from metadata; visibility changes none of selection, identity, capabilities or routing.

Flower groups icon/name rows by provider: inline title/search/close, icon tiles, selection outline/check and fixed footer. Desktop: viewport-bounded 17rem width, 20rem height cap, 24px minimum rows, 10px labels and 9px provider headings. Touch: 44px targets, 16px search. Preserve search, aliases, keyboard control, refresh and management. Hide limits, image/search capabilities, quantization and alias descriptions. Unavailable rows show brief status with tooltip/accessibility reasons. Attachment feedback requires checks or attention. Long names/headings truncate with tooltips; scroll vertically.

Both `GET /api/ai/models` modes share unfiltered `provider_catalogs` and backend `provider_defaults`: capabilities, never account availability, even before setup. Settings/drafts remain editable without usable models.

`LoadForStartup` freezes supported legacy selections before service start; no discovery wait or current-profile migration.

# Boundaries

Desktop/Env consume Runtime's authorized inventory. No Floret dependency, execution/storage change, schema migration or conversation store is added.

# Evidence

- `redeven:internal/ai/model_catalog_manager.go`
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx`

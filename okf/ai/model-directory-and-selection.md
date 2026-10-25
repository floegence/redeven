---
type: AI Configuration Contract
title: Model directory and selection
description: Runtime-owned metadata and explicit model selection.
tags: [ai, models, providers, settings]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Runtime owns atomic metadata snapshots. Reads/send preflight use shipped or saved metadata; pending/failed refresh never blocks configured chat. Background refresh is disclosed, opt-in and excludes OpenRouter. Adding OpenRouter/Ollama discovers models; manual refresh remains available.

# Contract

Runtime initializes from `runtime/model-catalog`. Inventory reads resolve shipped static defaults, avoiding stale capabilities; unreviewed models need explicit configuration. Cloud uses its catalog protocol without dispatch-time discovery.

Profiles separate selection, overrides, custom definitions and default identity from metadata. Visibility never selects models or changes identity, capabilities or wire routing.

Flower groups icon/name rows by provider in a compact picker, with title, search and close control on one line, small icon tiles, selected outline/checkmark and fixed footer. Desktop sizing uses a 19rem width, 25rem height cap, 32px minimum rows and 11px primary labels; viewport bounds can reduce the panel further. Coarse-pointer controls retain 44px targets and 16px search text. Search, aliases, keyboard control, refresh and management remain. Hide context/output limits, image/search capabilities, quantization and alias descriptions. Unavailable rows show a short status; tooltip/accessibility descriptions retain the reason. Attachment feedback appears only while checking or needing attention. Long names and headings truncate with tooltips; scrolling is vertical.

Both `GET /api/ai/models` modes share unfiltered `provider_catalogs` and backend `provider_defaults`. Defaults express capabilities, never account availability, even before configuration. With no usable model, settings and draft editing remain available.

`LoadForStartup` freezes supported legacy selections before services start. Startup never waits for discovery or migrates current profiles.

# Boundaries

Desktop/Env adapters consume Runtime's authorized inventory projection. No Floret dependency, execution/storage change, schema migration or conversation store is added.

# Evidence

- `redeven:internal/ai/model_catalog_manager.go` — Synchronization and atomic publication.
- `redeven:internal/config/ai_model_snapshot.go` — Credential-scoped snapshots.
- `redeven:internal/ai/provider_inventory.go` — Authentication and complete pagination.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx` — Responsive themes, containment and keyboard control.

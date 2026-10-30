---
type: AI Configuration Contract
title: Model directory and selection
tags: [ai, models, providers, settings]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Runtime owns atomic metadata. Reads/send preflight use shipped/saved snapshots; refresh never blocks configured chat. Background refresh is disclosed, opt-in and excludes OpenRouter. OpenRouter/Ollama discover on addition; manual refresh remains available.

# Contract

Runtime uses `runtime/model-catalog` and resolves shipped defaults on read. Unreviewed models require configuration. Cloud uses its catalog protocol without dispatch-time discovery.

Profiles separate selection, overrides, custom definitions and default identity from metadata; visibility changes none of selection, identity, capabilities or routing.

Flower groups icon/name rows by provider: inline title/search/close, icon tiles, selection outline/check and fixed footer. Desktop: viewport-bounded 17rem width, 20rem height cap, 24px minimum rows, 10px labels and 9px provider headings. Touch: 44px targets, 16px search. Preserve search, aliases, keyboard control, refresh and management. Hide limits, image/search capabilities, quantization and alias descriptions. Unavailable rows show brief status with tooltip/accessibility reasons. Attachment feedback requires checks or attention. Long names/headings truncate with tooltips; scroll vertically.

The shared Flower UI owns provider brand rendering in Desktop and Env App. Settings, provider dialogs and model selectors use unchanged, pinned theSVG assets recorded in assets/flower_provider_icons.json; checksums and licenses are verified by the third-party notice generator. Monochrome marks use the foreground color through an alpha mask, while color marks retain their original SVG bytes. Both Kimi connection types share Kimi; the legacy chatglm type displays Z.ai; custom OpenAI-compatible endpoints use the OpenAI protocol mark without asserting endpoint ownership. No host-specific SVG paths or runtime CDN requests are used.

Both `GET /api/ai/models` modes share unfiltered `provider_catalogs` and backend `provider_defaults`: capabilities, never account availability, even before setup. Settings/drafts remain editable without usable models.

A selected platform whose catalog is unavailable shows the localized model-check failure and recovery action, never the first-use setup welcome. Preserve draft and selection; explicit model-menu refresh recovers from an authoritative directory response.

`LoadForStartup` freezes supported legacy selections before service start; no discovery wait or current-profile migration.

# Boundaries

Desktop/Env consume Runtime's authorized inventory. No Floret dependency, execution/storage change, schema migration or conversation store is added.

# Evidence

- `redeven:internal/ai/model_catalog_manager.go`
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx`

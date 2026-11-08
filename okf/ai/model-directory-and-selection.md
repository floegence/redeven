---
type: AI Configuration Contract
title: Model directory and selection
tags: [ai, models, providers, settings]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Runtime owns atomic metadata. Background refresh is disclosed, opt-in and excludes OpenRouter. Runtime uses `runtime/model-catalog` and resolves shipped defaults on read. Identity-only unreviewed models require configuration. OpenAI-compatible inventories use Floret's public `ParseOpenAIModelMetadata`.

# Contract

Cloud uses its catalog protocol without dispatch-time discovery.

Explicit endpoint limits, modalities, tool declarations and reasoning efforts
survive atomic snapshots and restart. Field provenance separates endpoint facts
from inherited reviewed defaults, so old snapshots still refresh shipped defaults
and partial declarations override only reported fields. Full unknown wire IDs
remain intact; complete serving facts enable only explicitly selected models. A reasoning boolean never invents effort controls; advertised Ultra remains
capability-gated. Conflicting metadata rejects the complete refresh and preserves
the previous snapshot. ChatGPT, Google, Ollama and OpenRouter retain their own
inventory contracts.

Settings retain sparse user overrides, show unknown input capabilities, expose
the usable input budget and warn when a window override exceeds the endpoint's
reported limit. Reset restores endpoint facts. Refresh never silently changes
saved selection or manual settings.

Profiles separate selection, overrides, custom definitions and default identity from metadata; visibility changes none of selection, identity, capabilities or routing.

Flower groups icon/name rows by provider: inline title/search/close, icon tiles, selection outline/check and fixed footer. Desktop: viewport-bounded 17rem width, 20rem height cap, 24px minimum rows, 10px labels and 9px provider headings. Touch: 44px targets, 16px search. Preserve search, aliases, keyboard control, refresh and management. Hide limits, image/search capabilities, quantization and alias descriptions. Unavailable rows show brief status with tooltip/accessibility reasons. Attachment feedback requires checks or attention. Long names/headings truncate with tooltips; scroll vertically.

The shared Flower UI owns provider brand rendering in Desktop and Env App. Settings, provider dialogs and model selectors use unchanged, pinned theSVG assets recorded in assets/flower_provider_icons.json; checksums and licenses are verified by the third-party notice generator. Monochrome marks use the foreground color through an alpha mask, while color marks retain their original SVG bytes. Both Kimi connection types share Kimi; the legacy chatglm type displays Z.ai; custom OpenAI-compatible endpoints use the OpenAI protocol mark without asserting endpoint ownership. No host-specific SVG paths or runtime CDN requests are used.

Both `GET /api/ai/models` modes share unfiltered `provider_catalogs` and backend `provider_defaults`: capabilities, never account availability, even before setup. Settings/drafts remain editable without usable models.

A selected platform whose catalog is unavailable shows the localized model-check failure and recovery action, never the first-use setup welcome. Preserve draft and selection; explicit model-menu refresh recovers from an authoritative directory response.

`LoadForStartup` freezes supported legacy selections before service start; no discovery wait or current-profile migration.

# Boundaries

Desktop/Env consume Runtime's authorized inventory. Floret owns provider-neutral gateway metadata parsing. Redeven consumes its published release; no conversation schema or storage change is added.

# Evidence

- `redeven:internal/ai/model_catalog_manager.go`
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx`

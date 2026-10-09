---
type: AI Configuration Contract
title: Model directory and selection
description: Maintain an offline Agent catalog, model-specific capabilities, and user selection preferences without duplicate inventories.
tags: [ai, models, providers, settings]
timestamp: 2026-10-08T00:00:00Z
---

# Summary

Redeven owns model discovery, explicit user selection, and atomic configuration upgrades. Catalog refreshes never select new models or change a conversation's saved model. Both settings surfaces preserve unavailable selections and parameter edits; chat shows a bounded searchable menu. Discovery failure cannot substitute another model. Floret remains the released execution engine and owns provider transport and opaque state.

# Contract

## Selection and discovery

OpenAI, Anthropic, Gemini (`google`), Moonshot, GLM (`chatglm`), DeepSeek, Qwen, xAI, and Groq use the same generated catalog in Go and both settings surfaces. Groq exposes hosted Agent models; brand providers expose their own models. These providers, Ollama, and OpenRouter persist `model_selection.selected_models`, custom definitions where supported, and sparse parameter overrides. An explicit empty selection disables every model without deleting the provider. New providers start with no selections. Custom OpenAI-compatible endpoints retain manual `models` entries.

Resolution combines current availability with saved intent in memory. New catalog entries stay unselected. Select all applies only to current candidates. Search, collapse, refresh, removal, and reopening never derive selection from visible rows. Missing selections remain visible as unavailable in settings; their identities and overrides survive save and recovery. Clearing a selection retains its parameter edits and custom definitions. Inherited output capacity is capped by a smaller context override; explicit output limits remain validated as entered.

OpenRouter queries its configured `/models` endpoint with tool filtering. Refresh updates selected metadata without enabling additions. Wire IDs, including vendor paths, stay separate from local route identities. Explicitly entered OpenRouter custom definitions remain user-managed and do not claim discovered availability. Legacy local aliases continue resolving through their exact wire ID only while that ID is available.

Ollama queries `/api/tags`, `/api/ps`, and `/api/show`; only installed local models advertising tools qualify. Loaded context capacity takes precedence over `num_ctx`; otherwise use the conservative 4,096-token serving default capped by the model limit. Inventory, digest, quantization, and availability are transient metadata, never persisted as user intent. Discovery errors leave preferences intact and other providers usable. The settings refresh action retries discovery; selected models must resolve against current inventory before execution.

## Settings interaction

Runtime exposes two reads for the same directory projection. The baseline read
returns static configuration, the saved current identity, and pending dynamic
sources without contacting providers, Desktop, or the platform gateway. Flower
uses it together with settings and thread history during initialization. The
complete read refreshes dynamic sources concurrently under one five-second
budget, limits provider work to four concurrent requests, and settles every
source as ready or unavailable before returning. A source failure never clears
selection intent or blocks history, drafts, canvas navigation, or an already
usable static model.

The directory is scoped to the Runtime route, instance, authorization session,
and settings revision. Env Shell and Desktop App own one in-memory read resource
per scope; Tessiven and full Flower share only when those scope facts match.
Late responses are discarded after a scope or settings change, duplicate
refreshes share one request, and unmounting releases the subscription. The
directory is an observation, not a second persistence ledger or an execution
authorization.

Automatic model-list discovery has a five-second total catalog budget, shorter
than Desktop's bootstrap request deadline. A slow or disconnected dynamic
provider cannot prevent unrelated configured models from being listed. This
read-only budget neither changes selected identities nor authorizes missing
models. Explicit catalog discovery retains its own request deadline, and send
preflight still resolves the exact selected model against current inventory.

Candidate rows in both provider dialogs use model identity independently of metadata object allocation. Selection changes preserve the existing checkbox or action button, keyboard focus, and scroll position. Selection controls reserve their layout space; shared dialog actions move as a group below model details on narrow screens. Metadata refresh updates surviving rows without retaining obsolete labels or availability. Parameter edits remain reactive without rebuilding the candidate row.

## Chat presentation

The composer initially shows at most eight selected models, prioritized by the current identity and recent thread models, grouped by provider/source. Search covers the complete selected set, including aliases. Users explicitly expand all selected models or open model management. Keyboard opening focuses search; arrows navigate enabled rows, Home/End navigate the list, and Escape returns focus to the trigger. The scrollable list keeps search and management controls visible on narrow screens.

Ollama aliases fold only when digest, provider connection, and effective parameters agree. The current alias is the representative when selected. Quantization and other aliases remain visible; different quantizations or overrides remain separate choices. Folding is presentation only: saved defaults, wire names, and thread model identities are never rewritten. An unavailable current model remains identifiable and disabled, with a request to choose another model.

The generated directory stays outside the initial Env App bundle. Settings load on first use and remain mounted to preserve drafts. The lightweight composer menu helper does not import catalog data. Image input is resolved per model, including DeepSeek Vision, and participates in attachment capability revision; actual admission also requires a supported adapter route and authorized staged bytes.

[Provider configuration validation](provider-configuration-validation.md) owns required fields and credentials. Compatibility epoch 36 prevents older Desktop clients from reinterpreting explicit selections as exclusions. Existing epochs 9 through 35 retain their declared upgrade paths.

Model search capability follows [Model web search](model-web-search.md); selection alone never enables a search protocol.

## Configuration ownership

`LoadForStartup` freezes legacy selection once before services start. Old explicit brand, Ollama, and OpenRouter lists preserve only their listed identities. Known old preset values inherit current metadata; user differences become overrides. Custom definitions and retired model identities survive without admitting retired catalog entries. Custom compatible profiles remain manual.

Legacy brand exclusion profiles freeze the current catalog minus exclusions. Legacy Ollama exclusion profiles require a successful authenticated inventory query; startup preserves the original profile if discovery fails, and that provider remains unavailable pending review. The user can retry startup discovery or explicitly review/select models in settings. Merely opening, refreshing, or saving unrelated settings must not convert an unresolved profile to an empty selection. Bundle saves reject unresolved exclusion shapes. Explicit selection actions replace the legacy policy and preserve parameter overrides.

The owner atomically persists a completed conversion before publishing it. Write failure leaves the original file intact and fails startup. Read-only `Load` never migrates; current profiles never rediscover or rewrite during migration. Discovery and runtime resolution create no catalog database or Floret migration.

## Directory maintenance

Run `python3 scripts/model-catalog/generate.py --update` only for an intentional online update. Review `upstream.json`, official-source corrections in `overrides.json`, and the resulting `internal/config/model_catalog.generated.json` diff together. Normal generation and `--check` use only committed inputs, including in CI and startup. The snapshot records the original models.dev response SHA-256. The [provider compatibility review](provider-api-catalog-review.md) records current official APIs and released-engine constraints; a newer supplier catalog does not imply support in Floret's independent catalog. Explicit official status overrides take precedence over experimental-name inference. models.dev attribution is included in the distributed third-party notices.

Include publicly callable Preview and Experimental models when the adapter supports their Agent protocol; mark their status explicitly. Exclude deprecated, non-tool, and specialized audio, video, embedding, or non-text-output models. Review regional endpoints, token limits, image modalities, reasoning wire controls, response fields, and tool-result replay against official documentation. A newly introduced reasoning option or model search capability must fail generation until reviewed. Run `python3 -B scripts/model-catalog/test_generate.py` and `python3 scripts/model-catalog/generate.py --check` before committing catalog changes. `model_catalog_legacy.json` exists solely to recognize the one-time configuration source; it is never a live model source.

# Boundaries

Gemini uses the supported OpenAI-compatible endpoint with model-specific effort or budget controls. Its tool thought signatures stay in the existing opaque provider state, bound to exact tool identity and arguments, and are pruned with projected history. DeepSeek uses published Floret v7.25.2, including current Flash/alias capabilities and prepared-image support, as described in [DeepSeek Responses](deepseek-responses.md). No public Floret catalog API, host credential contract, or domain schema is added by this change.

# Evidence

- `redeven:internal/ai/service_models_test.go` - Unresponsive catalogs stay within the automatic inventory deadline without losing configured alternatives or preferences.

- `redeven:internal/config/ai_model_catalog.go` - Catalog and preference resolution.
- `redeven:internal/config/ai_model_migration.go` - Atomic startup conversion.
- `redeven:internal/config/ai_model_selection_upgrade_test.go` - Offline freeze, alias identity, rollback, restart, and unavailable selections.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.modelMenu.browser.test.tsx` - Search, alias presentation, keyboard, bounded menus, and narrow-screen geometry.
- `redeven:internal/ai/model_catalog.go` - Read-only OpenRouter and Ollama queries.
- `redeven:internal/ai/model_directory.go` - Baseline and bounded complete directory projection.
- `redeven:internal/codeapp/appserver/server_model_catalog_test.go` - Admin authorization, input limits, and unchanged configuration.
- `redeven:internal/envapp/ui_src/src/ui/flower/modelDirectory.test.ts` - Scoped single-flight reads, late-result fencing, and failure settlement.
- `redeven:internal/flower_ui/src/settings/modelSelection.ts` - Shared UI selection owner.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.selection.browser.test.tsx` - Real published dialogs, scroll and focus continuity, narrow layouts, catalog refresh, and parameter editing.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Real dialog search, collapse, switch, and reopen behavior.
- `redeven:internal/ai/attachment_capabilities_test.go` - Per-model vision across provider types.
- `redeven:internal/ai/model_gateway_gemini_test.go` - Streamed signatures, image input, and tool results.
- [models.dev](https://models.dev/) - Reviewed upstream directory.
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) - Supported request protocol.
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) - Serving context configuration.

---
type: AI Configuration Contract
title: Model directory and selection
description: Maintain an offline Agent catalog, model-specific capabilities, and user selection preferences without duplicate inventories.
tags: [ai, models, providers, settings]
timestamp: 2026-09-09T00:00:00Z
---

# Summary

Redeven owns the model directory, user selection preferences, credentials, and the one-time configuration conversion. A checked-in models.dev snapshot generates the exact catalog consumed by Go and both Flower settings surfaces. Brand catalogs default to all Agent models; users persist exclusions and parameter overrides. Image input is a variable model capability for every provider, including DeepSeek Vision. Current and default conversation models never change merely because the selectable catalog changes. Floret remains the published engine dependency and owns its own provider transport and opaque state.

# Contract

## Selection

OpenAI, Anthropic, Gemini (`google`), Moonshot, GLM (`chatglm`), DeepSeek, Qwen, xAI, and Groq use generated catalogs. Groq exposes its hosted Agent models; brand providers expose their own models. Brand profiles persist `model_selection.disabled_models`, `custom_models`, and sparse `model_overrides`, with no expanded `models` inventory. Resolution combines the current catalog and preferences in memory. New entries become enabled; excluded names remain excluded. An inherited output ceiling is bounded by a smaller user context window, while an explicit output override remains validated as entered. A custom entry that later appears upstream remains one model with the user's parameters.

OpenRouter queries its configured `/models` endpoint with tool filtering and starts with no selected models. Its explicit `models` list remains the user's selection. Ollama queries `/api/tags`, `/api/ps`, and `/api/show`; only installed, local models advertising tools appear. Its inventory is transient. Loaded context capacity takes precedence over `num_ctx`; an unloaded model with neither uses a conservative 4,096-token capacity capped by the model limit. This avoids treating theoretical context length as the configured OpenAI-compatible serving capacity. Custom compatible endpoints retain manual model entry.

The two settings entrances share catalog resolution, serialization, search, selection count, and bulk controls. Searching, collapsing, reopening, or refreshing never derives selection from visible rows. Disabling and re-enabling a model preserves parameter edits; clearing selection also retains custom definitions for later selection. Ollama API keys are optional. Offline Ollama discovery reports an error in its settings; other configured providers remain usable. Selecting all models changes the available range, not the new-chat default or a thread's persisted model.

The generated directory stays outside the Env App initial bundle. The settings panel loads on first use and remains mounted after opening, preserving drafts and pending autosave when returning to chat. Lightweight model display helpers do not import catalog data; the build graph gate enforces that boundary.

An unavailable current model remains its exact stored identity and is shown with a request to choose another model. It is never silently replaced. A model-specific image flag participates in the attachment capability revision, so text-only and vision models may coexist within any provider. Actual image admission also requires a supported adapter route and authorized staged bytes; a metadata reasoning flag never invents request parameters.

Compatibility epoch 16 requires matching Desktop and Runtime support for compact model preferences and the shared catalog endpoint. Older clients cannot save an empty expanded list over a catalog-owned profile. Existing epoch 9 through 15 upgrade paths remain available.

## Configuration ownership

`LoadForStartup` converts legacy brand profiles once, before Runtime services start. Original preset values inherit current metadata; user parameter changes become sparse overrides. Unknown custom entries remain custom. Retired original entries retain overrides and the current identity but do not reappear in the active catalog. Ollama legacy entries become overrides against the current installed inventory. OpenRouter and custom compatible profiles remain explicit selections.

The configuration owner atomically saves the converted file before publishing it to services. Failure leaves the original file intact and returns an error; ordinary read-only `Load` does not migrate. Restart of a current profile does not rewrite its bytes. This is Redeven configuration conversion, not a Floret domain migration or an additional catalog database.

## Directory maintenance

Run `python3 scripts/model-catalog/generate.py --update` only for an intentional online update. Review `upstream.json`, official-source corrections in `overrides.json`, and the resulting `internal/config/model_catalog.generated.json` diff together. Normal generation and `--check` use only committed inputs, including in CI and startup. The snapshot records the original models.dev response SHA-256; the 2026-09-09 baseline matches Floret's independently generated engine catalog. models.dev attribution is included in the distributed third-party notices.

Include publicly callable Preview and Experimental models when the adapter supports their Agent protocol; mark their status explicitly. Exclude deprecated, non-tool, and specialized audio, video, embedding, or non-text-output models. Review regional endpoints, token limits, image modalities, reasoning wire controls, response fields, and tool-result replay against official documentation. A newly introduced reasoning option must fail generation until reviewed. `model_catalog_legacy.json` exists solely to recognize the one-time configuration source; it is never a live model source.

# Boundaries

Gemini uses the supported OpenAI-compatible endpoint with model-specific effort or budget controls. Its tool thought signatures stay in the existing opaque provider state, bound to exact tool identity and arguments, and are pruned with projected history. DeepSeek uses published Floret v7.9.1, including v7.9.0 prepared-image support, as described in [DeepSeek Responses](deepseek-responses.md). No public Floret catalog API, host credential contract, or domain schema is added by this change.

# Evidence

- `redeven:internal/config/ai_model_catalog.go` - Catalog and preference resolution.
- `redeven:internal/config/ai_model_migration.go` - Atomic startup conversion.
- `redeven:internal/config/ai_model_catalog_test.go` - Conversion, rollback, restart, and future catalog entries.
- `redeven:internal/ai/model_catalog.go` - Read-only OpenRouter and Ollama queries.
- `redeven:internal/codeapp/appserver/server_model_catalog_test.go` - Admin authorization, input limits, and unchanged configuration.
- `redeven:internal/flower_ui/src/settings/modelSelection.ts` - Shared UI selection owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Real dialog search, collapse, switch, and reopen behavior.
- `redeven:internal/ai/attachment_capabilities_test.go` - Per-model vision across provider types.
- `redeven:internal/ai/model_gateway_gemini_test.go` - Streamed signatures, image input, and tool results.
- [models.dev](https://models.dev/) - Reviewed upstream directory.
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) - Supported request protocol.
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) - Serving context configuration.

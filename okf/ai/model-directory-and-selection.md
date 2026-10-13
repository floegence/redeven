---
type: AI Configuration Contract
title: Model directory and selection
description: Read configured model metadata immediately and make Provider inventory refresh an explicit opt-in without changing user intent.
tags: [ai, models, providers, settings]
timestamp: 2026-10-13T00:00:00Z
---

# Summary

The Runtime owns synchronization and atomic metadata snapshots. Reads and send preflight use shipped or saved metadata without waiting for supplier inventory. Failed or pending refresh never blocks configured chat. Background refresh is off by default, disclosed, and excludes OpenRouter. Adding OpenRouter/Ollama discovers their models; manual refresh remains available. Floret execution and storage contracts are unchanged.

# Contract

## One metadata owner

The Runtime loads `runtime/model-catalog` snapshots at initialization. Scope hashes bind provider identity, type, endpoint, authentication method, account, and credential fingerprint without storing credentials. Shipped and manual capabilities remain available before discovery and offline. Desktop model sources only read snapshots and preferences.

ChatGPT scopes use the bound account and ignore inactive API keys, including vault failures. Static models resolve current shipped defaults when inventory is read, so old snapshots cannot pin stale capabilities; models absent from the current review require explicit capability configuration. Google's serving limits and dynamic OpenRouter/Ollama metadata remain authoritative, followed by user overrides. Unavailable selections retain reviewed metadata for settings without invocation authority or becoming unconfirmed account choices. Empty reasoning structs and zero overrides do not erase defaults in Go or the shared UI projection. Catalogs include the server's reviewed search policy.

Opted-in background synchronization starts asynchronously at startup and repeats every 15 minutes for enabled supported providers except OpenRouter. Failures retry after 1, 5, and 15 minutes. Each provider has one in-flight operation, at most four globally, with a 30-second deadline including queueing. Disabled scheduling reads snapshots without Provider requests. Explicit `POST /api/ai/model_catalog` uses the same owner independently of this setting, including for OpenRouter. Draft discovery persists a scoped snapshot usable when the connection is saved.

OpenAI-compatible, Anthropic, and Google lists use their native authentication and pagination. OpenRouter uses tool-filtered inventory; Ollama reads tags, running context, and model details. Unsupported providers retain reviewed or manual metadata. Invalid, partial, repeated-page, timed-out, rate-limited, or unauthorized responses never replace a snapshot; disk publication failure retains the previous in-memory directory. A complete successful empty inventory is authoritative.

Cloud metadata remains in bounded memory, isolated by trusted user, namespace, environment, gateway, grant, and entitlement version. Cached metadata is not invocation authorization: actual requests still renew the lease and validate current route authority. Cloud execution consumes its catalog protocol rather than fetching inventory during dispatch.

## Selection and availability

Provider profiles own selection, sparse overrides, custom definitions, and default identity separately from metadata. Editors merge saved parameters without changing catalog identities or capabilities. Discoveries stay unselected; connections may be saved without models or a default. Row visibility never derives selection.

Only complete successful inventory can confirm absence or unsupported capability. Missing selections remain visible as unavailable, retaining identity, parameters, drafts, history, and the default. The next send requires an explicit model choice; synchronization does not cancel admitted work or silently substitute another model. Reappearance with valid capabilities restores availability under the same selection.

Unknown listed identities display “Needs capability configuration.” The editor accepts adapter-supported context/output limits, text/image input, tools, and reasoning declarations. Hand-entered capabilities cannot revive a missing model, override unsupported tools, or grant account access. Custom compatible endpoints retain manual `models`, while authoritative synchronization still constrains wire identity.

Ollama serving context prefers loaded capacity, then an explicit `num_ctx`, then its documented conservative 4,096-token default capped by model capacity. Alias folding requires matching digest, connection, and effective parameters. It changes presentation only, never stored identities or wire routing.

## Shared reads and settings

Both `GET /api/ai/models` modes return the same projection, including unfiltered `provider_catalogs` and backend `provider_defaults`. Defaults describe capabilities, never account availability, even before providers are configured. Settings returns `ai_models`, the local backend projection, without supplier discovery or session cloud requests. Configuration reads finish independently of directory reads. A `model_directory.changed` notification carries no provider/account data; observers reread their authorized projection without invalidating settings, reinitializing chat, or altering active runs.

Desktop and Env App share one settings/directory resource per Runtime route, instance, and authorization scope. Reads coalesce; invalidation rereads, connection changes fence old responses, and all reads settle within ten seconds. Failures retain metadata. Flower publishes only the current settings generation; stalled directories cannot block settings.

Editing connections never initiates discovery. Adding OpenRouter/Ollama discloses API requests independent of background updates: selecting Ollama discovers its default endpoint; leaving key/address inputs discovers changed connections. OpenRouter waits for a key; incomplete endpoints are skipped. Unchanged drafts attempt once, with manual retry after failure. Close, switch, and connection changes fence late results/errors; closing or switching types skips outgoing draft discovery. “Sync model list” retains old rows on failure. The background switch discloses API requests and the OpenRouter exclusion. Background metadata merges preserve unsaved connection fields and capability overrides. Stable model identities preserve focus and scroll position. The chat composer shows no automatic synchronization progress or failure notification. With no usable model, configuration remains reachable and the input draft remains editable.

## Configuration and generated capabilities

`LoadForStartup` freezes supported legacy selections before services start. Old explicit lists preserve identities and overrides; legacy exclusion conversion uses a usable local snapshot or leaves the original profile for review. Startup never waits for discovery, and current profiles are not rewritten by migration.

The generated catalog is backend-only and must not appear in Desktop or Env App JavaScript, including lazy settings chunks. Shared UI consumes read-only `provider_defaults` and `provider_catalogs`, storing only selections, custom definitions, and explicit overrides. Missing backend metadata stays unconfigured rather than receiving frontend substitutes. Optional directory defaults preserve the compatibility epoch; older catalogs and explicit synchronization remain usable. Catalog updates use `python3 scripts/model-catalog/generate.py --update` with reviewed inputs; ordinary generation and `--check` are offline. [Provider API catalog review](provider-api-catalog-review.md), [Provider configuration validation](provider-configuration-validation.md), and [Model web search](model-web-search.md) own their respective concerns.

Compatibility epoch 54 identifies the directory notification, capability metadata, and configured-without-selection profile contract. No Floret schema migration is added.

# Boundaries

The Runtime owns inventory, snapshots, and authorized projections consumed by Desktop and Env App Flower adapters. Credentials, account authorization, active runs, and selection retain their existing owners. This contract adds no Floret dependency or conversation store.

# Evidence

The 2026-10-13 audit compared all consumed fields for nine static providers against a fresh models.dev response (`f888d7b0a23ce8f9518f98888b54ec68f3039eec0f9720e8a106c3cd9922e8ca`). Those fields exactly match the maintained snapshot (`a6af79756a8a8efb5fd3144a83bd01f333e503043998d5f26f3c98bf9181d36c`): OpenAI 30, Anthropic 17, Google 14, Moonshot 4, Z.ai 18, DeepSeek 4, Qwen 45, xAI 4, Groq 4. All 140 models have reviewed token limits and input capabilities. The repair concerns snapshot/default resolution and settings propagation; it does not change model identities or invent new limits.

- `redeven:internal/ai/model_catalog_manager.go` - Single synchronization owner, scheduler, flights, deadlines, and publication.
- `redeven:internal/config/ai_model_snapshot.go` - Credential-scoped atomic snapshots and read-only Desktop projection.
- `redeven:internal/ai/provider_inventory.go` - Native authentication and complete pagination.
- `redeven:internal/ai/model_directory.go` - Immediate authorized projection.
- `redeven:internal/ai/platform_catalog.go` - Cloud scope isolation and silent refresh.
- `redeven:internal/ai/model_catalog_manager_test.go` - Default-off scheduling, explicit opt-in, offline restart, failed writes, late responses, removal/recovery, concurrency, and draft-save scope.
- `redeven:internal/codeapp/appserver/server.go` - Admin setting endpoint for the explicit automatic-update consent.
- `redeven:internal/ai/provider_inventory_test.go` - Pagination, authentication, partial failures, and empty success.
- `redeven:internal/config/ai_model_snapshot_test.go` - Manual override authority and snapshot isolation.
- `redeven:internal/envapp/ui_src/src/ui/flower/modelDirectory.test.ts` - Coalescing, invalidation races, late scope responses, and bounded reads.
- `redeven:internal/flower_ui/src/settings/modelSelection.ts` - Shared user intent and metadata merge.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Setup discovery, explicit retry, retained edits, and response fencing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.discovery.browser.test.tsx` - Shared setup requests, disclosure, cancellation, and deliberate model selection.
- `redeven:internal/ai/desktop_model_source.go` - Disk-only catalog publication and separate metadata notification.
- `redeven:internal/runtimeservice/compatibility_contract.json` - Protocol compatibility decision.

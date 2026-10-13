---
type: AI Configuration Contract
title: Model directory and selection
description: Read local model metadata immediately and synchronize complete inventories silently without changing user intent.
tags: [ai, models, providers, settings]
timestamp: 2026-10-13T00:00:00Z
---

# Summary

The Runtime owns model synchronization and atomic metadata snapshots. Directory reads, model selection, attachment checks, and send preflight consume existing metadata without waiting for supplier inventory. Automatic synchronization is silent. Only the explicit Provider settings action shows progress or errors. Floret remains the released execution engine; its public API and opaque session data are unchanged.

# Contract

## One metadata owner

The Runtime reads snapshots from the configuration root's `runtime/model-catalog` directory at initialization. Each scope hashes provider identity, type, endpoint, authentication method, account, and credential fingerprint; credentials are never written to snapshots. The generated catalog supplies reviewed capabilities before a successful inventory exists. Saved manual capabilities remain available offline. Desktop model-source processes only read these snapshots and configured preferences; they never discover suppliers themselves.

ChatGPT scopes use the bound account and ignore inactive API keys, including API-key vault failures. Known static models resolve current shipped defaults when an inventory is read, so a previous snapshot cannot pin stale context, output, image, or reasoning capabilities. Cached static models absent from the current review require explicit capability configuration; historical defaults cannot authorize them. Google's native serving limits and dynamic OpenRouter/Ollama metadata remain authoritative. Explicit user overrides apply afterward. Unavailable selected models retain reviewed metadata for settings, without gaining invocation authority or appearing as unconfirmed account choices. Empty nested reasoning structs and zero numeric overrides do not erase defaults in either the Go or shared UI projection. Directory catalogs include the server's reviewed search policy.

Synchronization starts asynchronously at startup and repeats every 15 minutes. Failures retry after 1, 5, and 15 minutes. Each provider has one in-flight operation, with at most four supplier operations globally and a 30-second overall deadline including queueing. Explicit `POST /api/ai/model_catalog` shares this owner and operation. Successful draft synchronization writes the same scoped snapshot, so saving the connection can immediately use the returned metadata.

OpenAI-compatible lists, Anthropic's native list, and Google's native list use their respective authentication and pagination. OpenRouter uses tool-filtered inventory. Ollama reads installed tags, running context, and complete model details. Providers without a supported inventory endpoint retain reviewed or manual metadata. Invalid, partial, repeated-page, timed-out, rate-limited, or unauthorized responses never replace a snapshot. Disk publication failure also retains the previous in-memory directory. Complete successful empty inventory is authoritative.

Cloud metadata remains in bounded memory, isolated by trusted user, namespace, environment, gateway, grant, and entitlement version. Cached metadata is not invocation authorization: actual requests still renew the lease and validate current route authority. Cloud execution consumes its catalog protocol rather than fetching inventory during dispatch.

## Selection and availability

User selection, sparse overrides, custom definitions, and the default identity remain in the provider profile, separately from metadata. The settings catalog retains original inventory identities and capabilities; editors merge saved parameters into choices without changing that serialization baseline. New providers and new discoveries stay unselected. A connection can be saved with no models and an empty default. Search, collapse, synchronization, and metadata allocation never derive selection from visible rows.

Only complete successful inventory can confirm absence or unsupported capability. Missing selections remain visible as unavailable, retaining identity, parameters, drafts, history, and the default. The next send requires an explicit model choice; synchronization does not cancel admitted work or silently substitute another model. Reappearance with valid capabilities restores availability under the same selection.

Unknown listed identities display “Needs capability configuration.” The existing editor accepts explicit context/output limits, text/image input, tools, and reasoning declarations supported by the selected adapter. Hand-entered capabilities cannot revive a missing model, override confirmed unsupported tools, or grant account access. Custom compatible endpoints retain manual `models`; their exact wire identity is still constrained after authoritative synchronization.

Ollama serving context prefers loaded capacity, then an explicit `num_ctx`, then its documented conservative 4,096-token default capped by model capacity. Alias folding requires matching digest, connection, and effective parameters. It changes presentation only, never stored identities or wire routing.

## Shared reads and settings

Both existing `GET /api/ai/models` modes return the same current projection, including `provider_catalogs` before user selection filtering and `provider_defaults` from the backend catalog for settings. Defaults describe capabilities, never account availability; they are returned even before a provider is configured. They perform no supplier inventory calls. A `model_directory.changed` notification travels on the existing Flower workspace live stream; it carries no provider/account data. Each observer rereads its authorized projection. Metadata notification does not invalidate settings, reinitialize chat, or alter an active run.

Desktop and Env App own a shared settings/directory read resource per Runtime route, instance, and authorization scope. Duplicate reads coalesce. Same-scope invalidation reacquires the latest result; connection changes fence old responses. Every read settles on success, failure, cancellation, or its ten-second local-read deadline. Failed refreshes retain known metadata. Flower reacquires the current settings generation before publishing, preventing permanent loading from a discarded coalesced request.

Opening Provider settings never initiates discovery. “Sync model list” displays progress only for that explicit action, reports failure within the current dialog, and leaves old rows and edits usable. Background metadata merges preserve unsaved connection fields and capability overrides. Stable model identities preserve focus and scroll position. The chat composer shows no automatic synchronization progress or failure notification. With no usable model, configuration remains reachable and the input draft remains editable.

## Configuration and generated capabilities

`LoadForStartup` freezes supported legacy selections before services start. Old explicit lists preserve their exact identities and overrides. Legacy dynamic exclusion conversion reads a usable local snapshot; without one, the original profile remains for explicit selection review. Startup never waits for provider discovery. Current profiles are neither rediscovered nor rewritten by migration.

The generated catalog is backend-only and must not appear in any Desktop or Env App JavaScript chunk, including lazy settings chunks. The shared UI consumes read-only `provider_defaults` and per-connection `provider_catalogs`; it stores only selected identities, custom definitions, and explicit overrides. Missing backend metadata stays unconfigured rather than receiving frontend numeric substitutes. Optional directory defaults preserve the current compatibility epoch; older Runtime directory catalogs and explicit synchronization remain usable. Intentional upstream updates use `python3 scripts/model-catalog/generate.py --update` with review of source inputs and adapter compatibility. Ordinary generation and `--check` are offline. [Provider API catalog review](provider-api-catalog-review.md) owns reviewed API combinations; [Provider configuration validation](provider-configuration-validation.md) owns credentials and structural fields; [Model web search](model-web-search.md) owns search capability.

Compatibility epoch 54 identifies the directory notification, capability metadata, and configured-without-selection profile contract. No Floret schema migration is added.

# Boundaries

The Runtime owns local provider inventory, snapshots, and authorized projections. Desktop and Env App consume those projections through the existing Flower adapters. Provider credentials, account authorization, active-run state, and user selection remain owned by their existing configuration and execution boundaries. This contract does not add a Floret dependency or a second conversation store.

# Evidence

The 2026-10-13 audit compared all consumed fields for nine static providers against a fresh models.dev response (`f888d7b0a23ce8f9518f98888b54ec68f3039eec0f9720e8a106c3cd9922e8ca`). Those fields exactly match the maintained snapshot (`a6af79756a8a8efb5fd3144a83bd01f333e503043998d5f26f3c98bf9181d36c`): OpenAI 30, Anthropic 17, Google 14, Moonshot 4, Z.ai 18, DeepSeek 4, Qwen 45, xAI 4, Groq 4. All 140 models have reviewed token limits and input capabilities. The repair concerns snapshot/default resolution and settings propagation; it does not change model identities or invent new limits.

- `redeven:internal/ai/model_catalog_manager.go` - Single synchronization owner, scheduler, flights, deadlines, and publication.
- `redeven:internal/config/ai_model_snapshot.go` - Credential-scoped atomic snapshots and read-only Desktop projection.
- `redeven:internal/ai/provider_inventory.go` - Native authentication and complete pagination.
- `redeven:internal/ai/model_directory.go` - Immediate authorized projection.
- `redeven:internal/ai/platform_catalog.go` - Cloud scope isolation and silent refresh.
- `redeven:internal/ai/model_catalog_manager_test.go` - Offline restart, failed writes, late responses, removal/recovery, concurrency, and draft-save scope.
- `redeven:internal/ai/provider_inventory_test.go` - Pagination, authentication, partial failures, and empty success.
- `redeven:internal/config/ai_model_snapshot_test.go` - Manual override authority and snapshot isolation.
- `redeven:internal/envapp/ui_src/src/ui/flower/modelDirectory.test.ts` - Coalescing, invalidation races, late scope responses, and bounded reads.
- `redeven:internal/flower_ui/src/settings/modelSelection.ts` - Shared user intent and metadata merge.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerProviderDialog.test.tsx` - Explicit synchronization and retained dialog edits.
- `redeven:internal/ai/desktop_model_source.go` - Disk-only catalog publication and separate metadata notification.
- `redeven:internal/runtimeservice/compatibility_contract.json` - Protocol compatibility decision.

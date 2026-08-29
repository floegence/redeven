---
type: Desktop Contract
title: Desktop session and model source
description: Session routing, Desktop model catalog, Flower attach, and lifecycle invalidation.
tags: [desktop, sessions, models, flower]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Desktop session context publishes an explicit target route and owns the current Environment session identity. Runtime Stop, Restart, and Update invalidate attached sessions at accepted lifecycle boundaries. Desktop owns one model-source process handle per Environment session without delaying Env App presentation; the process owns connection recovery while provider credentials remain local. Flower history remains available from persisted state when that live model source is unavailable.

# Contract

## Mechanism

Desktop main owns the complete session-context route contract. Every `DesktopSessionContextSnapshot` carries a required `target_route`: Local Environment targets publish their declared `local_host` or `remote_desktop` route, while SSH, Gateway, and External Local UI targets always publish `remote_desktop`. Preload and Env App accept only `local_host` or `remote_desktop` and reject an incomplete or invalid snapshot instead of inferring route from target kind, URL, SSH metadata, or browser placement. Env App therefore exposes the Desktop Flower model source only from the explicit `remote_desktop` route. The Desktop shell also owns the internal `flower_settings` navigation action, which opens or focuses Welcome Flower and advances an explicit settings-focus revision so the local Flower provider editor is focused without duplicating settings UI in Env App.

Desktop model-source RPC v1 publishes opaque `desktop:model_<hash>` identifiers plus an optional sanitized capability descriptor. Desktop resolves the real provider profile locally, then replaces provider and model identity in the descriptor with the opaque Desktop identity while retaining operational limits, modality support, tool-schema behavior, and reasoning controls. The runtime uses that descriptor consistently for UI model listing and execution. A runtime receiving an older v1 descriptor derives a compatibility capability from the existing model fields rather than guessing from the opaque hash. Provider ids, base URLs, API keys, and secret locations remain local to Desktop.

Desktop stores the model-source process handle immediately after spawn and opens the Env App without awaiting its startup report. There is no fixed eight-second kill boundary. One loop inside the model-source process owns both initial connection and later reconnection, uses capped backoff for transient network, timeout, rate-limit, and server failures, and stops immediately for authentication, configuration, or protocol failures. Desktop does not add a second retry owner. Session close cancels the connector, closes an in-progress WebSocket dial or read, and stops the exact process. A normal WebSocket close is reconnectable and never replaces a previously observed actionable failure with close code 1000.

Thread inventory and detail reads project persisted model id, reasoning selection, permissions, and working directory without consulting the live Desktop model catalog. Model capability remains live catalog state. Creating a thread, changing its model or reasoning selection, and accepting a new send still validate the selected Desktop model against the current source and fail closed while it is disconnected. The send preflight runs after idempotency lookup, so retrying an already accepted request returns its canonical result without admitting new work. Draft editing and persisted history remain usable during connection recovery; Redeven adds no cached model directory, read-only mode, queued-send fallback, or second retry loop.

The same RPC carries final model results under one complete ToolCall contract: every final call has a non-empty id and canonical name plus a present JSON argument object. An empty argument object is encoded as `args:{}` rather than omitted, while missing or `null` arguments fail at the shared model-gateway result validator before any call enters Floret. Streaming start and delta events remain partial observations and do not weaken the final-result contract. Desktop validates before writing the result frame and the runtime validates the decoded result again as a transport boundary; neither side repairs a malformed call or substitutes empty arguments.

Desktop Welcome has one Local Environment Flower readiness path for settings, thread inventory, and stream requests. It attaches immediately when Runtime Service is openable. A cold Runtime starts through the existing Desktop lifecycle coordinator, and concurrent first requests coalesce on that same Start. An active Start, Restart, or Update is joined, marked with the explicit `flower_warmup` presentation context, and awaited before Desktop revalidates Runtime Service, invalidates the stale local access session, and attaches again. An active Stop or Reinstall fails immediately and never triggers a replacement Start. Open or Refresh ownership permits only an already-openable attach; otherwise the existing lifecycle conflict is returned. Lifecycle failure remains structured and terminal for that request: Flower adds no retry, polling, cache, or second startup path. The Flower surface renders coordinated Start, Restart, and Update progress as warmup instead of treating the surface as stalled.

Desktop Welcome uses the same Flower adapter contract as Env App for thread operations and split settings writes. Sending a turn posts through the runtime Flower IPC proxy, stop posts to the thread cancel route, and `/compact` posts to `/_redeven_proxy/api/ai/threads/{thread}/context/compact` before reloading the canonical live bootstrap. Default permission writes use the exact `PUT /_redeven_proxy/api/ai/default_permission` route, provider profile writes use `PUT /_redeven_proxy/api/ai/provider_bundle`, and composer model selection writes the future new-thread default through `PUT /_redeven_proxy/api/ai/current_model`. The Desktop bridge also exposes the Flower working-directory picker through exact read-only runtime FS paths: `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list`. The bridge allowlist is a single route table that admits only declared paths, methods, and query shapes, so the permission route is PUT-only and path selection data travels in the POST body instead of opening arbitrary query-path proxying. The Desktop bridge treats compaction as a thread action, not as a transcript message or a local UI-only marker, so Desktop and Env App receive the same live timeline decorations and read-state patches from the runtime.

# Boundaries

Runtime-control is also not a plugin grant, plugin management, or plugin capability plane. Its token and routes are reserved for Desktop-to-Runtime coordination such as provider-link, code-workspace-engine import, and Desktop model source binding. Plugin workers and sandbox surfaces must not receive runtime-control endpoint data, use runtime-control bearer tokens, or treat runtime-control routes as plugin capabilities; plugin access to Redeven resources must go through released ReDevPlugin brokers and Redeven-registered adapters.

# Evidence

- `redeven:desktop/src/main/main.ts:9863` - Welcome Flower attaches or joins the single coordinated Local Environment lifecycle readiness path.
- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:235` - Only Start, Restart, and Update may be awaited as ready-producing mutations.
- `redeven:desktop/src/welcome/App.tsx:3073` - The Flower warmup state only consumes lifecycle progress marked with the `flower_warmup` presentation context.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:315` - Flower renders the explicit warmup state without replacing selected-thread content.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:443` - Desktop Flower compaction posts to the runtime compact endpoint and reloads live bootstrap.
- `redeven:internal/localui/runtime_control.go:134` - Runtime-control routes are limited to provider-link, code-workspace-engine, and Desktop model source handlers.
- `redeven:internal/ai/desktop_model_source.go:1132` - Desktop builds the model capability from the local provider profile before publishing the model snapshot.
- `redeven:desktop/src/main/desktopModelSource.ts:117` - Desktop returns an owned process handle immediately and exposes connection readiness separately.
- `redeven:internal/ai/desktop_model_source.go:807` - One connector loop owns initial connection and capped-backoff reconnection classification.
- `redeven:internal/ai/threads.go:91` - Thread read projections use persisted settings without querying the live model catalog.
- `redeven:internal/ai/send_user_turn.go:177` - New sends validate Desktop model availability after idempotency lookup.
- `redeven:internal/ai/model_gateway_result.go:36` - One validator owns final ToolCall completeness for provider, Desktop RPC, and Floret mapping boundaries.
- `redeven:internal/localui/device_ca.go:39` - Local UI device trust is an explicit generated CA lifecycle, independent of Desktop session routing.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:1173` - Desktop and Env App implement the same split settings adapter contract.
- `redeven:internal/envapp/ui_src/src/ui/services/desktopSessionContext.ts:71` - Env App independently validates the required route before consuming Desktop session context.

---
type: Desktop Contract
title: Desktop session and model source
description: Session routing, Desktop model catalog, Flower attach, and lifecycle invalidation.
tags: [desktop, sessions, models, flower]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Desktop session context publishes an explicit target route and owns the current Environment session identity. Runtime Stop, Restart, and Update invalidate attached sessions at accepted lifecycle boundaries. Desktop model-source RPC exposes opaque model ids while keeping provider credentials local, and Welcome reuses the same coordinated Runtime and Flower adapter paths instead of maintaining a separate AI session implementation.

# Contract

## Mechanism

Desktop main owns the complete session-context route contract. Every `DesktopSessionContextSnapshot` carries a required `target_route`: Local Environment targets publish their declared `local_host` or `remote_desktop` route, while SSH, Gateway, and External Local UI targets always publish `remote_desktop`. Preload and Env App accept only `local_host` or `remote_desktop` and reject an incomplete or invalid snapshot instead of inferring route from target kind, URL, SSH metadata, or browser placement. Env App therefore exposes the Desktop Flower model source only from the explicit `remote_desktop` route. The Desktop shell also owns the internal `flower_settings` navigation action, which opens or focuses Welcome Flower and advances an explicit settings-focus revision so the local Flower provider editor is focused without duplicating settings UI in Env App.

Desktop model-source RPC v1 publishes opaque `desktop:model_<hash>` identifiers plus an optional sanitized capability descriptor. Desktop resolves the real provider profile locally, then replaces provider and model identity in the descriptor with the opaque Desktop identity while retaining operational limits, modality support, tool-schema behavior, and reasoning controls. The runtime uses that descriptor consistently for UI model listing and execution. A runtime receiving an older v1 descriptor derives a compatibility capability from the existing model fields rather than guessing from the opaque hash. Provider ids, base URLs, API keys, and secret locations remain local to Desktop.

When Desktop Welcome opens Flower and the Local Environment runtime is cold, the Flower attach path uses the same coordinated local lifecycle. It joins an active Start, Restart, or Update, marks that launcher attempt with the explicit `flower_warmup` presentation context, waits for settlement, and attaches again. An active Stop makes Flower explicitly unavailable and never triggers a replacement Start. The Flower surface renders coordinated Start, Restart, and Update progress as warmup instead of treating the surface as stalled.

Desktop Welcome uses the same Flower adapter contract as Env App for thread operations and split settings writes. Sending a turn posts through the runtime Flower IPC proxy, stop posts to the thread cancel route, and `/compact` posts to `/_redeven_proxy/api/ai/threads/{thread}/context/compact` before reloading the canonical live bootstrap. Default permission writes use the exact `PUT /_redeven_proxy/api/ai/default_permission` route, provider profile writes use `PUT /_redeven_proxy/api/ai/provider_bundle`, and composer model selection writes the future new-thread default through `PUT /_redeven_proxy/api/ai/current_model`. The Desktop bridge also exposes the Flower working-directory picker through exact read-only runtime FS paths: `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list`. The bridge allowlist is a single route table that admits only declared paths, methods, and query shapes, so the permission route is PUT-only and path selection data travels in the POST body instead of opening arbitrary query-path proxying. The Desktop bridge treats compaction as a thread action, not as a transcript message or a local UI-only marker, so Desktop and Env App receive the same live timeline decorations and read-state patches from the runtime.

# Boundaries

Runtime-control is also not a plugin grant, plugin management, or plugin capability plane. Its token and routes are reserved for Desktop-managed runtime coordination such as provider-link, code-workspace-engine import, and Desktop model source binding. Plugin workers and sandbox surfaces must not receive runtime-control endpoint data, use runtime-control bearer tokens, or treat runtime-control routes as plugin capabilities; plugin access to Redeven resources must go through released ReDevPlugin brokers and Redeven-registered adapters.

# Evidence

- `redeven:desktop/src/main/main.ts:8220` - Welcome Flower cold-starts Local Environment through structured local runtime lifecycle progress.
- `redeven:desktop/src/welcome/App.tsx:3073` - The Flower warmup state only consumes lifecycle progress marked with the `flower_warmup` presentation context.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:315` - Flower renders the explicit warmup state without replacing selected-thread content.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:443` - Desktop Flower compaction posts to the runtime compact endpoint and reloads live bootstrap.
- `redeven:internal/localui/runtime_control.go:134` - Runtime-control routes are limited to provider-link, code-workspace-engine, and Desktop model source handlers.
- `redeven:internal/ai/desktop_model_source.go:1132` - Desktop builds the model capability from the local provider profile before publishing the model snapshot.
- `redeven:internal/config/catalog.go:117` - Runtime catalog writeback preserves bind-scoped plaintext acknowledgement across managed restart.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:1173` - Desktop and Env App implement the same split settings adapter contract.
- `redeven:internal/envapp/ui_src/src/ui/services/desktopSessionContext.ts:71` - Env App independently validates the required route before consuming Desktop session context.

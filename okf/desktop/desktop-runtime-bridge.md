---
type: Desktop Contract
title: Desktop runtime bridge
description: Desktop starts and probes Desktop-managed runtimes through machine startup reports, Local UI health, and runtime-control.
tags: [desktop, runtime-control, local-ui, compatibility]
timestamp: 2026-06-30T00:00:00Z
---

Redeven Desktop treats the endpoint runtime as a managed service when it launches `redeven run --mode desktop --desktop-managed`. The handoff is machine-readable: Desktop receives Local UI URLs, runtime-control endpoint data, Runtime Service readiness, and startup failures without parsing human terminal output.

# Mechanism

The CLI requires Desktop-managed Local UI runs to use machine presentation, writes startup reports, records Desktop owner metadata in the runtime lock, and exposes runtime-control only to loopback callers with the Desktop owner header and bearer token. Desktop probes `/api/local/runtime/health`, normalizes Runtime Service snapshots in TypeScript, verifies Env App shell readiness by inspecting the shell HTML and asset references, and builds the Env App entry URL from a normalized Local UI base URL. When Desktop Welcome opens Flower and the Local Environment runtime is cold, the Flower attach path starts that same local runtime lifecycle through launcher operation progress; the Flower surface uses the explicit `flower_warmup` presentation context to show runtime startup as a warmup state instead of treating the surface as stalled.

Desktop Welcome uses the same Flower adapter contract as Env App for thread operations. Sending a turn posts through the runtime Flower IPC proxy, stop posts to the thread cancel route, and `/compact` posts to `/_redeven_proxy/api/ai/threads/{thread}/context/compact` before reloading the canonical live bootstrap. Composer model selection writes the future new-thread default through the same proxy using the exact `PUT /_redeven_proxy/api/ai/current_model` route. The Desktop bridge also exposes the Flower working-directory picker through exact read-only runtime FS paths: `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list`. The bridge allowlist is a single route table that admits only declared paths, methods, and query shapes, so path selection data travels in the POST body instead of opening arbitrary query-path proxying. The Desktop bridge treats compaction as a thread action, not as a transcript message or a local UI-only marker, so Desktop and Env App receive the same live timeline decorations and read-state patches from the runtime.

# Boundaries

Runtime-control is not a general network API. It is scoped to the local Desktop/runtime bridge and protected by loopback, Desktop owner id, and bearer token checks. Flower warmup is a Desktop presentation context over the existing runtime lifecycle operation, not a separate readiness source or a parser for runtime terminal output. Desktop must not implement alternate Flower thread semantics locally; thread stop, send, compact, working-directory path context/list reads, and live reload flow through the runtime proxy contract.

Runtime-control is also not a plugin grant, plugin management, or plugin capability plane. Its token and routes are reserved for Desktop-managed runtime coordination such as provider-link, code-workspace-engine import, and Desktop model source binding. Plugin workers and sandbox surfaces must not receive runtime-control endpoint data, use runtime-control bearer tokens, or treat runtime-control routes as plugin capabilities; plugin access to Redeven resources must go through released ReDevPlugin brokers and Redeven-registered adapters.

# Citations

[1] redeven:cmd/redeven/main.go:292 - Desktop-managed startup is rejected for remote-only mode.
[2] redeven:cmd/redeven/main.go:310 - Desktop-managed startup requires machine-compatible presentation.
[3] redeven:cmd/redeven/main.go:627 - Runtime lock metadata records desktop-managed state and Desktop owner id.
[4] redeven:cmd/redeven/main.go:771 - Desktop-ready startup reports include Local UI, runtime-control, and Runtime Service data.
[5] redeven:internal/localui/runtime_control.go:23 - Runtime-control protocol version is `redeven-runtime-control-v1`.
[6] redeven:internal/localui/runtime_control.go:166 - Runtime-control endpoint data includes base URL, token, and Desktop owner id.
[7] redeven:internal/localui/runtime_control.go:193 - Runtime-control requests require loopback, matching Desktop owner id, and bearer token.
[8] redeven:desktop/src/main/runtimeState.ts:119 - Desktop probes Local UI runtime health at `/api/local/runtime/health`.
[9] redeven:desktop/src/main/runtimeState.ts:135 - Desktop validates the Env App shell HTML before treating it as ready.
[10] redeven:desktop/src/main/localUIURL.ts:44 - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
[11] redeven:desktop/src/main/main.ts:7524 - Welcome Flower cold-starts Local Environment through structured local runtime lifecycle progress.
[12] redeven:desktop/src/welcome/App.tsx:3073 - The Flower warmup state only consumes lifecycle progress marked with the `flower_warmup` presentation context.
[13] redeven:internal/flower_ui/src/FlowerSurface.tsx:315 - Flower renders the explicit warmup state without replacing selected-thread content.
[14] redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:443 - Desktop Flower compaction posts to the runtime compact endpoint and reloads live bootstrap.
[15] redeven:desktop/src/main/main.ts:7450 - The Desktop Flower bridge allowlist admits the fixed FS path context route.
[16] redeven:desktop/src/main/main.ts:7486 - The Desktop Flower bridge method allowlist permits `POST` for the fixed FS list route.
[17] redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:496 - The Desktop Flower adapter reads working-directory path context and list data through the runtime bridge.
[18] redeven:internal/localui/runtime_control.go:134 - Runtime-control routes are limited to provider-link, code-workspace-engine, and Desktop model source handlers.
[19] redeven:okf/security/plugin-platform-integration-security.md:58 - Plugin surfaces and workers must not receive Desktop runtime-control tokens as ambient authority.

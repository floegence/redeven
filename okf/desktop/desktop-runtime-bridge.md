---
type: Desktop Contract
title: Desktop runtime bridge
description: Desktop starts and probes Desktop-managed runtimes through machine startup reports, Local UI health, and runtime-control.
tags: [desktop, runtime-control, local-ui, compatibility]
timestamp: 2026-07-12T00:00:00Z
---

Redeven Desktop treats the endpoint runtime as a managed service when it launches `redeven run --mode desktop --desktop-managed`. The handoff is machine-readable: Desktop receives Local UI URLs, runtime-control endpoint data, Runtime Service readiness, and startup failures without parsing human terminal output.

# Mechanism

The CLI requires Desktop-managed Local UI runs to use machine presentation, writes startup reports, records Desktop owner metadata in the runtime lock, and exposes runtime-control only to loopback callers with the Desktop owner header and bearer token. Desktop separates runtime health from Env App shell integrity. Health-only probes call `/api/local/runtime/health` and are used for recurring liveness refreshes and forwarded-runtime polling. Once Runtime Service reports an openable state, Desktop performs one shell validation: it loads the Env App HTML, extracts unique entry assets, and validates those assets with concurrent `HEAD` requests under one deadline. Successful shell validation is cached by normalized Local UI URL, runtime start time, and runtime build identity; failed or changed runtime identities are validated again. Desktop then builds the Env App entry URL from the normalized Local UI base URL.

SSH open preserves on-demand connection ownership. A click may reuse a matching ready record only when the associated health snapshot is still fresh within the 30-second TTL. Stale or mismatched state triggers one explicit refresh. If a reused fresh record fails specifically because its forward is unavailable, Desktop refreshes once and retries the formal connection; authentication, maintenance, cancellation, and other failures do not cause an automatic retry. The forwarded Local UI loop polls health only and runs shell validation once after the runtime becomes openable, so SSH round-trip latency does not multiply by the number of Env App entry assets.

Environment windows remain hidden until two readiness gates settle: Env App reports either an interactive access gate or a connected runtime protocol after a painted shell frame, and the Desktop model source has settled. For SSH opens, model-source startup begins in parallel with hidden session creation and document loading. Model-source failure retains the existing unavailable fallback but still settles its gate, so it does not block Env App. The renderer reports relative bootstrap, access, protocol, and shell-paint timings through the internal app-ready IPC. Launcher operations retain phase start and duration data, and successful opens emit a desensitized `environment_open_timing` lifecycle event with cache, probe, SSH, model-source, window, document, gate, and renderer timing data.

When Desktop Welcome opens Flower and the Local Environment runtime is cold, the Flower attach path starts that same local runtime lifecycle through launcher operation progress; the Flower surface uses the explicit `flower_warmup` presentation context to show runtime startup as a warmup state instead of treating the surface as stalled.

Desktop Welcome uses the same Flower adapter contract as Env App for thread operations. Sending a turn posts through the runtime Flower IPC proxy, stop posts to the thread cancel route, and `/compact` posts to `/_redeven_proxy/api/ai/threads/{thread}/context/compact` before reloading the canonical live bootstrap. Composer model selection writes the future new-thread default through the same proxy using the exact `PUT /_redeven_proxy/api/ai/current_model` route. The Desktop bridge also exposes the Flower working-directory picker through exact read-only runtime FS paths: `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list`. The bridge allowlist is a single route table that admits only declared paths, methods, and query shapes, so path selection data travels in the POST body instead of opening arbitrary query-path proxying. The Desktop bridge treats compaction as a thread action, not as a transcript message or a local UI-only marker, so Desktop and Env App receive the same live timeline decorations and read-state patches from the runtime.

# Boundaries

Runtime-control is not a general network API. It is scoped to the local Desktop/runtime bridge and protected by loopback, Desktop owner id, and bearer token checks. Health freshness and shell validation caches are reuse decisions, not background connection authority: Desktop must not preconnect SSH, warm tunnels at startup, or keep a hidden SSH session solely to improve a future click. Window readiness is also not satisfied by `did-finish-load` alone; presentation remains gated by the renderer's painted interactive state and model-source settlement. Flower warmup is a Desktop presentation context over the existing runtime lifecycle operation, not a separate readiness source or a parser for runtime terminal output. Desktop must not implement alternate Flower thread semantics locally; thread stop, send, compact, working-directory path context/list reads, and live reload flow through the runtime proxy contract.

Runtime-control is also not a plugin grant, plugin management, or plugin capability plane. Its token and routes are reserved for Desktop-managed runtime coordination such as provider-link, code-workspace-engine import, and Desktop model source binding. Plugin workers and sandbox surfaces must not receive runtime-control endpoint data, use runtime-control bearer tokens, or treat runtime-control routes as plugin capabilities; plugin access to Redeven resources must go through released ReDevPlugin brokers and Redeven-registered adapters.

# Citations

[1] redeven:cmd/redeven/main.go:292 - Desktop-managed startup is rejected for remote-only mode.
[2] redeven:cmd/redeven/main.go:310 - Desktop-managed startup requires machine-compatible presentation.
[3] redeven:cmd/redeven/main.go:627 - Runtime lock metadata records desktop-managed state and Desktop owner id.
[4] redeven:cmd/redeven/main.go:771 - Desktop-ready startup reports include Local UI, runtime-control, and Runtime Service data.
[5] redeven:internal/localui/runtime_control.go:23 - Runtime-control protocol version is `redeven-runtime-control-v1`.
[6] redeven:internal/localui/runtime_control.go:166 - Runtime-control endpoint data includes base URL, token, and Desktop owner id.
[7] redeven:internal/localui/runtime_control.go:193 - Runtime-control requests require loopback, matching Desktop owner id, and bearer token.
[8] redeven:desktop/src/main/runtimeState.ts:124 - Desktop probes Local UI runtime health at `/api/local/runtime/health`.
[9] redeven:desktop/src/main/runtimeState.ts:188 - Desktop validates Env App HTML and entry assets under a shared deadline.
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
[20] redeven:desktop/src/main/runtimeState.ts:219 - Shell validation cache identity includes Local UI URL, runtime start time, and runtime build identity.
[21] redeven:desktop/src/main/sshRuntime.ts:1401 - Forwarded Local UI readiness polls health and validates the shell once after Runtime Service becomes openable.
[22] redeven:desktop/src/main/desktopWelcomeRuntimeHealth.ts:54 - Desktop runtime health freshness uses a 30-second TTL.
[23] redeven:desktop/src/main/main.ts:12125 - SSH open reuses only a fresh health snapshot with a matching ready record.
[24] redeven:desktop/src/main/main.ts:12217 - A reused SSH forward receives one refresh-and-retry only for the allowed cached-forward failure.
[25] redeven:desktop/src/main/main.ts:12264 - SSH Desktop model-source startup begins before hidden session creation.
[26] redeven:desktop/src/main/main.ts:7230 - Desktop presents the window only after Env App and model-source readiness gates both settle.
[27] redeven:desktop/src/main/main.ts:7246 - App-ready IPC timing values are normalized and bounded before use.
[28] redeven:desktop/src/main/main.ts:7340 - Successful environment opens record desensitized phase and renderer timing diagnostics.

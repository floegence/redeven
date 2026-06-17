---
type: Desktop Contract
title: Desktop runtime bridge
description: Desktop starts and probes Desktop-managed runtimes through machine startup reports, Local UI health, and runtime-control.
tags: [desktop, runtime-control, local-ui, compatibility]
timestamp: 2026-06-17T00:00:00Z
---

Redeven Desktop treats the endpoint runtime as a managed service when it launches `redeven run --mode desktop --desktop-managed`. The handoff is machine-readable: Desktop receives Local UI URLs, runtime-control endpoint data, Runtime Service readiness, and startup failures without parsing human terminal output.

# Mechanism

The CLI requires Desktop-managed Local UI runs to use machine presentation, writes startup reports, records Desktop owner metadata in the runtime lock, and exposes runtime-control only to loopback callers with the Desktop owner header and bearer token. Desktop probes `/api/local/runtime/health`, normalizes Runtime Service snapshots in TypeScript, verifies Env App shell readiness by inspecting the shell HTML and asset references, and builds the Env App entry URL from a normalized Local UI base URL.

# Boundaries

Runtime-control is not a general network API. It is scoped to the local Desktop/runtime bridge and protected by loopback, Desktop owner id, and bearer token checks.

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

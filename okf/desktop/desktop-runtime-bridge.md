---
type: Desktop Contract
title: Desktop runtime bridge
description: Canonical navigation and security boundary for Desktop-managed Runtime integration.
tags: [desktop, runtime, bridge, lifecycle]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Redeven Desktop launches and supervises managed Runtime instances through machine-readable startup, scoped control, transport, session, and process contracts. This overview is the canonical navigation point for readiness, recovery, SSH operations, and model/session integration. Focused concepts own the independent lifecycle details while the bridge overview retains the security boundary between Desktop coordination, Runtime APIs, and plugin capabilities.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [Desktop runtime readiness](desktop-runtime-readiness.md)

- [Desktop transport recovery](desktop-transport-recovery.md)

- [Desktop SSH runtime operations](desktop-ssh-runtime-operations.md)

- [Desktop session and model source](desktop-session-model-source.md)

Native Local Environment transport is independent from public Local UI addressing. Runtime writes required `local_ui_bridge_url` state into the private `0600` Desktop launch/status report, while public `local_ui_url` and ordered `local_ui_urls` remain display and external-access addresses. Native BrowserWindow loading, health verification, access unlock, and Desktop Flower requests require the validated HTTP loopback-IP root and never fall back to a Tailscale, VPN, RFC1918, or other public interface address. Runtime health returns public URLs for native display refresh while the request itself stays on the trusted bridge. SSH and container placement health preserves the Desktop-owned stable loopback proxy rather than replacing it with a remote interface address.

`desktopSessionTransport` resolves the immutable transport kind, base URL, entry URL, display URL, navigation boundary, proxy policy, and partition before a session window exists. Native Local Environment, SSH/container placement, and Gateway loopback sessions use session-scoped non-persistent Electron partitions configured with `setProxy({ mode: 'direct' })` before the first load. Root, child, access-gate, and codespace windows share that partition, and session closure clears its storage. Provider remote and external Local UI sessions continue to use the default Session and system proxy policy.

WebRequest diagnostics are installed idempotently for every Electron Session that Desktop uses. An opening root document with final HTTP status 400 or greater fails immediately with transport kind, proxy policy, and status diagnostics; Chromium network failures remain immediate through `did-fail-load`. The readiness timeout remains only for a successfully loaded document that never reports an interactive access gate or connected Runtime state. Renderer projections, Welcome snapshots, persisted preferences, and user diagnostics omit `local_ui_bridge_url` and retain the public display URL.

# Boundaries

Runtime-control is a local Desktop coordination capability, not a general network API or plugin grant plane. Bridge, health, process, and session observations must not become competing lifecycle authorities. Desktop must not change the system proxy, install Tailscale/VPN/private-range bypass tables, globally disable proxying, or recover a missing trusted bridge by selecting a public Local UI address. ReDevPlugin, Provider, Runtime Control, public Local UI, and Gateway contracts retain their existing ownership boundaries.

# Evidence

- `redeven:cmd/redeven/main.go:299` - Desktop-managed startup is rejected for remote-only mode.
- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - Ready and attached private reports require and validate the trusted bridge URL.
- `redeven:internal/localui/localui.go:417` - Runtime starts a separate ephemeral loopback listener for trusted Desktop transport.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Desktop resolves transport, display, proxy, and partition state through one contract.
- `redeven:desktop/src/main/main.ts:8222` - Session creation prepares direct Electron proxy state before loading Desktop-owned loopback transport.
- `redeven:desktop/src/main/main.ts:16928` - Per-Session diagnostics fail opening root documents on final HTTP errors.
- `redeven:okf/desktop/desktop-runtime-process-lifecycle.md:1` - Runtime process inventory and lifecycle ordering are maintained as a separate Desktop contract.
- `redeven:desktop/src/main/main.ts:8854` - Welcome Flower cold-starts Local Environment through structured local Runtime lifecycle progress.

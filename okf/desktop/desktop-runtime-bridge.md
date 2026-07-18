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

# Boundaries

Runtime-control is a local Desktop coordination capability, not a general network API or plugin grant plane. Bridge, health, process, and session observations must not become competing lifecycle authorities.

# Evidence

- `redeven:cmd/redeven/main.go:292` - Desktop-managed startup is rejected for remote-only mode.
- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
- `redeven:okf/desktop/desktop-runtime-process-lifecycle.md:1` - Runtime process inventory and lifecycle ordering are maintained as a separate Desktop contract.
- `redeven:desktop/src/main/main.ts:8220` - Welcome Flower cold-starts Local Environment through structured local runtime lifecycle progress.

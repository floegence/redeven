---
type: Gateway Contract
title: Gateway service
description: redeven-gateway is a separate Gateway service binary with managed lifecycle and Desktop bridge support.
tags: [gateway, desktop, release, runtime]
timestamp: 2026-06-17T00:00:00Z
---

Gateway is no longer folded into the Runtime Service snapshot. It is a separate `redeven-gateway` binary and service surface that Desktop can manage, bridge, pair, and use for Gateway-owned environment profiles.

# Mechanism

The Gateway CLI exposes `serve`, `desktop-bridge`, `service-status`, `service-start`, `service-stop`, and `version`. Managed service start creates a bridge token, launches `serve` in the background, records a PID/listen status file, and waits for readiness. `desktop-bridge` verifies that the service is running and that the managed bridge token exists, then serves the Gateway protocol bridge over stdio. The release workflow builds and packages `redeven-gateway` alongside the main `redeven` binary.

# Boundaries

Gateway state, pairing, profile write enablement, and private-profile-target allowance are Gateway service concerns. Runtime Service compatibility stays separate unless the runtime snapshot contract itself changes.

# Citations

[1] redeven:cmd/redeven-gateway/main.go:83 - `serve` accepts state root, listen address, private target, profile write, and pairing flags.
[2] redeven:cmd/redeven-gateway/main.go:116 - `desktop-bridge` exposes the Gateway protocol bridge over stdio.
[3] redeven:cmd/redeven-gateway/main.go:188 - `service-start` starts a managed Gateway service in the background.
[4] redeven:cmd/redeven-gateway/main.go:217 - Managed service start ensures a managed bridge token exists.
[5] redeven:cmd/redeven-gateway/main.go:227 - Managed service start launches `serve` with state and listener flags.
[6] redeven:cmd/redeven-gateway/main.go:254 - `service-stop` terminates a running managed Gateway service and removes managed state markers.
[7] redeven:cmd/redeven-gateway/main.go:293 - Gateway service construction receives Desktop bridge, profile target, profile write, pairing, and token options.
[8] redeven:cmd/redeven-gateway/main.go:495 - CLI help lists the Gateway command set.
[9] redeven:.github/workflows/release.yml:72 - Release builds the `redeven-gateway` binary.
[10] redeven:internal/runtimeservice/compatibility_contract.json:8 - The current compatibility review records Gateway service decoupling as outside the Runtime Service window.

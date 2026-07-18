---
type: Security Contract
title: Local UI network exposure
description: Explicit plaintext Local UI exposure requires fixed IP binding, password authentication, and bind-scoped risk acknowledgement.
tags: [security, local-ui, desktop, env-app, flowersec]
timestamp: 2026-07-17T00:00:00Z
---
# Summary

Redeven supports direct Local UI access from another machine only as an explicit plaintext network exposure mode. Loopback remains the default. Network exposure is never inferred, migrated, downgraded, or enabled by an environment-variable acknowledgement.

# Contract

## Admission Contract

A network listener starts only when all three facts are true: the bind is a concrete non-loopback IP or wildcard with a fixed nonzero port, an effective Local UI password exists, and `--acknowledge-plaintext-network-exposure` is present. The acknowledgement is rejected for loopback and remote-only modes. Desktop persists acknowledgement version 1 against the canonical bind and adds the CLI flag only when that exact bind still matches. Runtime catalog writeback records the same versioned acknowledgement only when the current startup carried the explicit flag, binds it to the actual listener label, and clears it for loopback startup. Missing, stale, or malformed acknowledgement blocks startup and leaves the saved settings intact for review.

Wildcard binds enumerate active same-family interface addresses after the listener opens. Redeven excludes loopback, unspecified, multicast, link-local, zoned, mapped, inactive, and duplicate addresses, sorts the remainder, and fails if none remain. Display URLs, startup reports, Runtime attach status, health, and access status use these real addresses rather than wildcard placeholders.

## Request Boundary

The public listener accepts only exact canonical IP authorities created from the bound or enumerated addresses and actual port. It rejects DNS names, wildcard authorities, userinfo, paths, malformed or noncanonical ports, zones, mapped IPv6, and unlisted IPs before routing. Browser Direct WebSocket requests require exact request scheme and authority equality with Origin. Direct WebSocket URLs are built only from the validated request authority.

Trusted Desktop, SSH, and container traffic enters through an independent `127.0.0.1:0` listener that mounts the trusted bridge handler and accepts canonical loopback authorities only. Its required attach URL is machine-only and never joins public display or exposure projections. SSH and container placement bridges execute `redeven desktop-bridge` and stream through that listener; they never forward the public Local UI port, rewrite Host, retry through the public URL, or select a compatibility transport. An established SSH bridge may replace only its private stdio transport after the same remote process generation proves the original identity; this does not create a public listener, alternate URL, or Runtime restart path. Runtime-control, Desktop model-source, and runtime management sockets remain loopback, token, owner, or local-socket protected and are not widened by Local UI exposure.

## Security Meaning

`LocalUIExposure` is the single projected posture: `scope` is `loopback` or `network`, `transport` is `plaintext`, and `password_required` records access control. It appears in CLI presentation, Desktop startup and attach status, Runtime health, Local UI access status, and Env App state.

Password authentication does not provide transport confidentiality or integrity. A network observer can capture or modify the password, cookies, page resources, and any non-Flowersec HTTP traffic. Flowersec E2EE protects its session payload only after the handshake completes. Env App therefore uses `AllowPlaintextForLoopback` for loopback hostnames and Flowersec's host-scoped network plaintext policy for an exact network IP with explicit pre-E2EE credential exposure acceptance. Policy construction failure blocks connection and never selects a weaker policy.

Desktop shows a persistent warning while network exposure is active. Desktop review occurs inside the existing settings window and binds confirmation to the canonical address. Env App renders its warning with the shared Activity/Workbench shell and exposes the actual access URLs and complete boundary in a desktop detail panel or mobile bottom sheet. In a Desktop window, the warning participates in the shared native-titlebar contract: its content uses the current platform's window-control insets, its non-interactive area remains draggable, and its actions remain explicitly interactive. The same markup keeps the normal browser spacing when no Desktop window-chrome contract is present. The user may close the Env App warning for the current renderer mount or choose not to be reminded again. The persistent choice is a versioned renderer-scoped UI preference, so direct browser access remains scoped by browser origin and Desktop access remains scoped by the local environment renderer identity. Missing, malformed, or unsupported preference data fails open by showing the warning. Hiding the presentation does not alter Runtime admission, password requirements, Flowersec policy selection, or projected exposure state.

# Boundaries

No additional boundary is declared for this concept.

# Evidence

- `redeven:internal/localui/bind.go:21` - Bind parsing and interface selection enforce canonical fixed-port network addresses.
- `redeven:internal/localui/http_security.go:21` - Listener resolution creates exact authorities and real access URLs.
- `redeven:cmd/redeven/main.go:230` - Runtime CLI defines the explicit acknowledgement flag and admission checks.
- `redeven:internal/runtimemanagement/local_ui_exposure.go:1` - LocalUIExposure is the canonical status contract.
- `redeven:desktop/src/main/desktopPreferences.ts:2195` - Desktop validates password and bind-scoped acknowledgement before saving.
- `redeven:desktop/src/main/desktopLaunch.ts:47` - Desktop appends acknowledgement argv only for a matching reviewed network bind.
- `redeven:desktop/src/welcome/App.tsx:12820` - Desktop settings provides inline warning and same-window review.
- `redeven:internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts:1` - Env App selects loopback or exact-host Flowersec policy without fallback.
- `redeven:internal/envapp/ui_src/src/ui/security/networkExposureWarningPreference.ts:1` - Env App stores only a versioned renderer-scoped warning suppression preference and fails open on invalid data.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3270` - Env App renders the titlebar-safe warning, details, current-mount close, and persistent do-not-remind actions.
- `redeven:internal/config/catalog.go:117` - Runtime catalog writeback preserves exact startup acknowledgement instead of dropping it after restart.
- `redeven:cmd/redeven/desktop_bridge.go:42` - `desktop-bridge` dials only the required trusted Local UI bridge URL.
- `redeven:internal/desktopbridge/server.go:205` - Trusted bridge URL validation admits only root-path HTTP loopback endpoints.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:337` - Established placement bridges keep one loopback proxy while replacing only a verified private transport.

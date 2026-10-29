---
type: Desktop Contract
title: Desktop runtime readiness
tags: [desktop, runtime, startup, readiness]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop admits a managed Environment only after its exact direct target reports compatible Runtime service and Local UI readiness. Gateway/Provider/URL access readiness is separate. Missing, stopped, outdated or damaged Runtime selects direct Start, Update or reinstall recovery. Startup status gaps remain bounded waits. Retained diagnoses preserve presentation only; current Presence and command-time validation own authority.

# Contract

## Direct readiness
Native Local Environment is available on macOS/Linux; Windows uses registered WSL Environments. A newly published listener without final status remains pending within the startup deadline. Desktop update warns that Desktop and Local Runtime restart and interrupt Local sessions; Later changes nothing.

WSL, SSH and container observations use the saved channel. Unknown/failed health offers Refresh with its real diagnostic. Pending refresh retains prior diagnosis/startup age but withdraws live Presence; completion replaces it. Main retains credential-free `observed_runtime_control_status` until probe failure or management-configuration change. Gateway failure affects only that route.

A completed probe preserves missing-control diagnostics even when it publishes no Presence. Unknown or unauthenticated status must not become an observed stopped Runtime. Missing diagnostics may guide recovery but never grant live management capability; only current Presence can do so.

Direct lifecycle actions remain available in every diagnosis. Failed nested recovery names the actual operation and retains structured diagnostics; raw stderr appears only in technical details.

## Access and Flower
[Verified access routes](desktop-environment-access.md) owns association/defaults. Gateway directory presence, membership and application probing are distinct; failure never changes routes or starts Runtime recovery.

[Runtime Flower access](../../desktop/src/shared/runtimeFlowerAccess.ts) checks actual protocol/epoch for commands, subscriptions, frames and attachments. Desktop restart does not prove Runtime changed. Welcome admits Flower only with compatible openable Runtime and AI `ready`/`degraded`; transitional states show preparation with a return action, while missing/blocked/unavailable facts cannot admit requests.

# Boundaries

Only Desktop chooses managed Runtime recovery. Optional platform display fields cannot change readiness or compatibility admission.

# Evidence

- `redeven:desktop/src/main/desktopBundle.ts:1` - Runtime-only bundle identity and file validation.

- `redeven:desktop/src/main/runtimeProcess.ts:1` - Local inventory and status lookup path contract.

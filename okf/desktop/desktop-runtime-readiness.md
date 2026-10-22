---
type: Desktop Contract
title: Desktop runtime readiness
description: Direct Runtime health, access readiness, and Open recovery boundaries.
tags: [desktop, runtime, startup, readiness]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop derives managed Runtime readiness from the exact Local, SSH, or container target, while access-only Gateway/Provider/URL readiness remains separate. A managed Environment opens only after the current Runtime reports compatible service and Local UI readiness. Missing, stopped, old, or damaged Runtime state selects a direct Desktop Start, Update, or reinstall recovery; it never invokes Gateway or Provider lifecycle. A transient status gap during startup is observed within the bounded readiness deadline and is not treated as process exit. Retained control diagnoses support presentation continuity only; live Presence and command-time validation retain management authority.

# Contract

## Local Environment
Every Desktop installation includes a managed Local Environment.

A new process that has published listeners but not yet published final status remains in the bounded startup wait.

Desktop update handoff tells the user that installation restarts Desktop and the Local Runtime and interrupts Local sessions; choosing Later changes nothing.

## Managed remote readiness
SSH-host, local-container, and SSH-container readiness is observed through the saved direct channel.

Unknown or failed health offers Refresh with the real direct-channel diagnostic.

A pending refresh retains that observation and its startup age while withdrawing live presence; completed results replace it.

## Observation continuity and authority
The main-process Welcome health store retains each target’s completed credential-free control diagnosis in `observed_runtime_control_status`. Probe failure or changed management configuration clears it.

Gateway failure affects only sessions routed through that Gateway.

## Capability and progress
Local and registered SSH/container targets are direct managed Environments and retain all direct lifecycle actions in every diagnosis state.

If nested recovery fails, the card names the failed Runtime operation, such as Start failed, and its details retain the structured failure and diagnostics.

Raw command stderr remains literal only inside technical diagnostics.

# Boundaries

[Verified access routes](desktop-environment-access.md) owns identity association and locally saved access defaults.

## Gateway access readiness
Gateway directory presence, active membership and the Runtime application probe are distinct readiness facts. Failure never triggers another route or a Runtime lifecycle action.

Desktop is the only component that decides and executes a managed Runtime recovery.

## Desktop Flower compatibility
Desktop's bundled Flower client uses [one protocol check](../../desktop/src/shared/runtimeFlowerAccess.ts) for HTTP commands, workspace subscriptions, computer frames and attachment entrypoints. The actual Runtime must report the supported protocol and compatibility epoch.

Desktop restart alone is not evidence that the background Runtime changed.

## Desktop Flower AI preparation
Welcome admits Flower only when the compatible, openable Runtime reports AI `ready` or `degraded`. Transitional AI states show localized preparation with an always-available return action; blocked, unavailable, or missing AI facts remain explicit and cannot admit requests.

Missing platform fields do not change readiness or compatibility admission.

# Evidence

- `redeven:desktop/src/main/desktopBundle.ts:1` - Runtime-only bundle identity and file validation.

- `redeven:desktop/src/main/desktopWelcomeRuntimeState.ts:1` - Local readiness hydration with explicit state and Runtime roots.

- `redeven:desktop/src/main/runtimeProcess.ts:1` - Local inventory and status lookup path contract.

---
type: Desktop Contract
title: Desktop runtime readiness
description: Independent access readiness, lifecycle capability projection, and window-open gates.
tags: [desktop, runtime, startup, readiness]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

Desktop keeps Connect, Workspace, Runtime UI, and Runtime management readiness independent. A Runtime may start and serve ordinary access without Gateway. Management UI projects support, authorization, and readiness in that order, so missing Gateway is setup guidance rather than Runtime offline state.

# Contract

## Capability projection

Local, SSH, local-container, and SSH-container paths with a clear supervisor setup route report `support=supported`; URL paths report `unsupported`. With a grant, no binding is `setup_required`, and an existing binding with an unavailable Gateway is `temporarily_unavailable`. Without a grant, target, generation, operations, artifact policies, and supervisor facts remain hidden. Provider uses the same projection from RCPP v3.

## Startup and access

Local UI password and network exposure acknowledgement are startup configuration, not Runtime lifecycle ownership. Health probes are read-only and do not start, stop, or reconnect a service. SSH/container bridge startup performs one typed health and open-readiness probe before opening a window; failed probes end that open attempt without selecting another transport. Existing bridge recovery validates exact process, token, target, and protocol identity, and never migrates a session to a different Runtime.

An accepted destructive lifecycle operation closes the attached Env App session through the shared operation coordinator. A disconnected Desktop leaves the Gateway operation running; a later open attaches to the durable progress. Lifecycle incompatibility disables only the management area; Connect, Workspace, and Runtime UI remain available.

# Boundaries

Desktop does not display Desktop ownership, takeover, or another lifecycle controller. Provider setup requires an explicit direct card or one-time interactive code and never borrows another card's credentials or a public URL control path.

# Evidence

- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Shared support/authorization/readiness projection and preflight.
- `redeven:desktop/src/shared/desktopRuntimeHealth.ts:1` - Typed health observation independent from lifecycle commands.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:337` - One exact bridge session identity for SSH and container access.
- `redeven:desktop/src/welcome/App.tsx:1` - Localized management readiness and operation presentation.

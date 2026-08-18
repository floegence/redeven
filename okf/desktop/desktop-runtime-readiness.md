---
type: Desktop Contract
title: Desktop runtime readiness
description: Independent access readiness, lifecycle capability projection, and window-open gates.
tags: [desktop, runtime, startup, readiness]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

Desktop keeps Connect, Workspace, Runtime UI, and managed lifecycle readiness independent. A Runtime may start and serve ordinary access without Gateway. Environment rows present the user outcome `Open`; support, authorization, readiness, and lifecycle authority remain internal facts that decide whether Open is direct or requires one confirmation flow.

# Contract

## Capability projection

Local, SSH, local-container, and SSH-container paths with a clear supervisor setup route report `support=supported`; URL paths report `unsupported`. With a grant, no binding is `setup_required`, and an existing binding with an unavailable Gateway is `temporarily_unavailable`. Without a grant, target, generation, operations, artifact policies, and supervisor facts remain hidden. Provider uses the same projection from RCPP v3.

## Startup and access

Local UI password and network exposure acknowledgement are startup configuration, not Runtime lifecycle ownership. Health probes are read-only and do not start, stop, or reconnect a service. SSH/container bridge startup performs one typed health and open-readiness probe before opening a window; failed probes end that open attempt without selecting another transport. Existing bridge recovery validates exact process, token, target, and protocol identity, and never migrates a session to a different Runtime.

An accepted destructive lifecycle operation closes the attached Env App session through the shared operation coordinator. A disconnected Desktop leaves the Gateway operation running; a later open attaches to the durable progress. Lifecycle incompatibility disables only the management area; Connect, Workspace, and Runtime UI remain available.

## Unified open flow

Every Environment row uses `Open` as its primary action. URL and other access-only connections open directly. A running Runtime also opens directly, even when lifecycle setup facts are unavailable or stale. For a lifecycle-capable Environment, a confirmed missing setup opens one `Initialize and open` panel; an initialized but stopped Runtime opens one `Start and open` panel. Provider authorization denial is resolved before initialization work begins and presents `Request access`.

The initialization panel owns its interaction until completion. It reports `Check access`, `Prepare environment`, `Start environment`, and `Open workspace` in execution order while the internal Gateway progress remains hidden. The start-only path omits the preparation stage. Success opens the workspace and closes the panel. Failure preserves the exact user-facing reason in that panel and exposes `Retry initialization`; an access failure exposes `Request access`. Snapshot refresh and lower-level operation progress cannot prematurely replace or complete this session.

# Boundaries

Environment open guidance does not display Gateway, Desktop ownership, target binding, takeover, or lifecycle-controller terminology. Provider setup never borrows another card's credentials or a public URL control path; authorization and target selection remain enforced behind the product action.

# Evidence

- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Shared support/authorization/readiness projection and preflight.
- `redeven:desktop/src/shared/desktopRuntimeHealth.ts:1` - Typed health observation independent from lifecycle commands.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:337` - One exact bridge session identity for SSH and container access.
- `redeven:desktop/src/welcome/viewModel.ts:1237` - Direct, initialize, start, and request-access open-flow decision.
- `redeven:desktop/src/welcome/environmentGuidanceSession.ts:1` - Panel ownership, ordered stages, failure retention, and retry state.
- `redeven:desktop/src/welcome/App.tsx:5104` - One localized initialize/start/open orchestrator.

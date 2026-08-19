---
type: Desktop Contract
title: Desktop runtime readiness
description: Independent access readiness, lifecycle capability projection, and window-open gates.
tags: [desktop, runtime, startup, readiness]
timestamp: 2026-08-19T00:00:00Z
---
# Summary

Desktop keeps Connect, Workspace, Runtime UI, and managed lifecycle readiness independent. Packaged Desktop startup validates and starts the bundled Gateway, Runtime, bridge, and Workspace readiness path before the Local Environment is presented as ready. Environment rows present the user outcome `Open`; support, authorization, readiness, and lifecycle authority remain internal facts that decide whether Open is direct or requires one confirmation flow.

# Contract

## Capability projection

Local, SSH, local-container, and SSH-container paths with a clear supervisor setup route report `support=supported`; URL paths report `unsupported`. With a grant, no binding is `setup_required`, and an existing binding with an unavailable Gateway is `temporarily_unavailable`. Without a grant, target, generation, operations, artifact policies, and supervisor facts remain hidden. Provider uses the same projection from RCPP v3.

## Startup and access

Desktop validates the bundled manifest, exact file inventory, version, commit, platform, architecture, executable permissions, sizes, and digests before starting the Local Environment service chain. Validation or startup failure is a launcher-level startup issue with repair/retry guidance; it is not deferred until Open, converted into a source build, or hidden behind an unbounded readiness wait. Startup logs record access check, environment preparation, environment start, Workspace readiness, total elapsed time, Runtime PID/version/digest, and the final readiness outcome.

Local UI password and network exposure acknowledgement are startup configuration, not Runtime lifecycle ownership. The Local Environment catalog `local_hosting.state_dir` is the Runtime state root itself; attach, status, lifecycle, and Open must not reinterpret its parent as another root. Long Unix control-socket paths resolve through a stable `/tmp` digest path so independently launched Desktop, Gateway, and Runtime processes address the same socket even when their inherited `TMPDIR` values differ. Health probes are read-only and do not start, stop, or reconnect a service. SSH/container bridge startup performs one typed health and open-readiness probe before opening a window; failed probes end that open attempt without selecting another transport. Readiness failures retain the probe stage and diagnostics: a Runtime hello that proves incompatibility routes to Update, while an unknown health response remains a Retry check path. Desktop never presents the raw `invalid_response` string as the user decision; HTML or asset mismatch is classified as Runtime readiness incompatibility and offers the same Update action. Existing bridge recovery validates exact process, token, target, and protocol identity, and never migrates a session to a different Runtime. A non-fresh Local or SSH observation always takes this short authoritative preflight on Open; an incompatible Runtime routes to an explicit Update action, while an unknown or failed check offers Retry check rather than Retry initialization.

An accepted destructive lifecycle operation closes the attached Env App session through the shared operation coordinator. A disconnected Desktop leaves the Gateway operation running; a later open attaches to the durable progress. Lifecycle incompatibility disables only the management area; Connect, Workspace, and Runtime UI remain available.

Gateway restart recovery also migrates the durable operation store before attach refresh. Historical nanosecond snapshot revisions are converted to bounded, stable values during the atomic v2-to-v3 migration; invalid revisions from preflight or lifecycle fencing are rejected before persistence, so Desktop receives a retryable operation failure instead of an attach-refresh parsing error.

## Unified open flow

Every Environment row uses `Open` as its primary action. After successful packaged Desktop startup, Local Environment is already ready and Open performs only connection, bridge, and Workspace readiness work. URL and other access-only connections open directly. A running Runtime also opens directly, even when lifecycle setup facts are unavailable or stale. When a Local or SSH Runtime has not been observed yet, or its cached observation is not fresh, that same Open click owns one transient access preflight: successful access opens immediately, while a failed attempt refreshes the Environment and continues in the same panel as start, update, initialization, or access guidance. It must not surface the obsolete offline error before evaluating that refreshed lifecycle state. For a lifecycle-capable Environment, a confirmed missing setup opens one `Initialize and open` panel; an initialized but stopped Runtime opens one `Start and open` panel. `Start and open` creates only a Gateway start operation over the already installed verified Runtime; it never copies source, builds assets or Runtime, uploads an artifact, or changes the action into Update. An existing binding whose managed service stopped with Desktop is still initialized: `Start and open` uses the authorized lifecycle entrypoint, which restores that service before starting the Runtime, instead of falling back to a direct offline Open. Provider authorization denial is resolved before initialization work begins and presents `Request access`.

The initialization panel owns its interaction until completion. It reports `Check access`, `Prepare environment`, `Start environment`, and `Open workspace` in execution order while the internal Gateway progress remains hidden. The start-only path omits the preparation stage. A lifecycle success is not enough to complete the action: Desktop waits for a fresh Runtime health sample with open readiness before opening, and waits for a fresh offline sample after stop. The final Open request remains authoritative when the first renderer snapshot is stale. Success opens the workspace and closes the panel. Failure preserves the exact user-facing reason in that panel and exposes the next reason-specific action: Retry check, Prepare environment, Upgrade runtime, or Request access. Snapshot refresh and lower-level operation progress cannot prematurely replace or complete this session.

# Boundaries

Environment open guidance does not display Gateway, Desktop ownership, target binding, takeover, or lifecycle-controller terminology. Provider setup never borrows another card's credentials or a public URL control path; authorization and target selection remain enforced behind the product action.

# Evidence

- `redeven:desktop/src/shared/desktopRuntimeOperationPlanner.ts:1` - Shared support/authorization/readiness projection and preflight.
- `redeven:desktop/src/main/desktopBundle.ts:1` - Startup-time packaged service validation and fail-closed diagnostics.
- `redeven:desktop/src/main/main.ts:10183` - Automatic Local Gateway, Runtime, bridge, and Workspace readiness sequence with phase timing.
- `redeven:desktop/src/shared/desktopRuntimeHealth.ts:1` - Typed health observation independent from lifecycle commands.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:337` - One exact bridge session identity for SSH and container access.
- `redeven:desktop/src/main/runtimeLifecycleReadiness.ts:1` - Fresh online/openable and offline completion barriers.
- `redeven:desktop/src/main/statePaths.ts:1` - Stable cross-process Unix control-socket fallback.
- `redeven:desktop/src/welcome/viewModel.ts:1239` - Direct, preflight, initialize, start, and request-access open-flow decision.
- `redeven:desktop/src/welcome/environmentOpenPreflight.ts:1` - Unknown-state Open preflight and refreshed lifecycle routing.
- `redeven:desktop/src/welcome/environmentOpenPreflight.smoke.test.ts:1` - Open, initialize, start, and authorization smoke outcomes.
- `redeven:desktop/src/welcome/environmentGuidanceSession.ts:1` - Panel ownership, ordered stages, failure retention, and retry state.
- `redeven:desktop/src/welcome/App.tsx:5104` - One localized initialize/start/open orchestrator.
- `redeven:scripts/smoke_desktop_runtime_lifecycle.mjs:1` - Real Local and SSH Remote Open and lifecycle outcomes.

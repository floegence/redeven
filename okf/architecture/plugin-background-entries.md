---
type: Architecture Contract
title: Plugin background entries
description: ReDevPlugin starts and recovers one headless background entry per plugin instance and environment without creating a Redeven visual surface.
tags: [architecture, plugins, background, redevplugin]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Background entries are a generic ReDevPlugin lifecycle mechanism, not a
Codex-specific hidden page. A plugin declares `runtime_start` or `on_demand`;
the platform starts one headless worker per plugin instance and environment,
keeps it independent from visible Activity or Workbench surfaces, and exposes
only lifecycle outcomes. The platform stops it on disable, uninstall,
revocation, and Host close. Plugin business protocol state is not owned or
recovered by Redeven.

# Contract

`runtime_start` entries are recovered after Host startup and runtime recovery;
`on_demand` entries start only after the plugin requests them through its
declared lifecycle. Starts are idempotent and concurrent starts are serialized.
Closing a visible surface does not stop a running background entry. A failed
entry becomes a diagnostic state that can be retried by the plugin or user;
Redeven does not infer or recreate thread, turn, JSON-RPC, or external-service
business state.

The Env App projects background declarations during installation review and
projects `Starting`, `Running`, `Exited`, `Blocked`, `Crashed`, and `Stream gap`
for the latest process-related diagnostic. Status changes update only the
owning plugin instance and do not lock Plugin Center, Activity, Workbench, or
Composer.

# Boundaries

This concept owns headless plugin-entry lifecycle and recovery boundaries.
Process stream ownership is defined by [Plugin process sessions](plugin-process-sessions.md);
Redeven owns only the installation-review projection, permission state, and
diagnostic presentation described by [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- ReDevPlugin `pkg/background/manager.go` owns idempotent starts, recovery, owner cleanup, and shutdown.
- ReDevPlugin `pkg/host/background_worker_runner.go` validates the declared worker, permissions, environment scope, and runtime invocation.
- Redeven `internal/envapp/ui_src/src/ui/plugins/pluginProcessStatus.ts` projects redacted process diagnostics into user-facing status.
- ReDevPlugin `pkg/background/manager_test.go` covers runtime-start recovery, on-demand exclusion, concurrent start serialization, and shutdown.

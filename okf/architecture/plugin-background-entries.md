---
type: Architecture Contract
title: Plugin background entries
tags: [architecture, plugins, background, redevplugin]
lifecycle: contract
reviewed_at: "2026-10-31"
---
# Summary

ReDevPlugin owns headless Worker lifecycle and durable intervals. A plugin may declare runtime_start, on_demand or interval. The first two use the platform background manager: starts are idempotent, scoped to the installed instance and environment, and independent of visible Activity or Workbench surfaces.

# Contract

Interval requires background.method.v1 and background.interval.v1, an explicit method and parameters, an environment-scoped job Worker, synchronous execution, no confirmation or preflight, a 1,000–86,400,000 ms period, and a 1–300,000 ms execution budget not exceeding the period.

The platform persists and claims each due invocation before dispatch. One instance runs at most one interval invocation; separate plugins remain independent. The first run waits one period, then each next run follows completion plus the period. Missed periods coalesce. Restart preserves completed plans; an unfinished claim becomes unknown and is never replayed. A later period is new work, not proof of the earlier result. Disable, uninstall, package replacement and revocation fence and cancel exact current work. Host close drains execution before closing state. ReDevPlugin owns contiguous control-store migration and unknown-outcome handling.

Redeven's background policy snapshots the validated runtime LocalMax intersected with the Env App application cap, then applies the existing method-effect rules. It does not depend on an online session, borrow a user's cached authority, or apply a per-user override to an environment-owned job. Admin and unknown effects are denied. The platform separately verifies owner, installed package trust, current grants, revisions, runtime admission and the durable claim. This policy grants no filesystem, process, secret or network resource: adapters requiring a live user session continue to reject background access. Selected-file and connection approvals retain their existing lifetime and owner rules.

An explicit install/enable action authorizes the declared environment lifecycle through the ordinary product review and platform APIs. Permission removal blocks future dispatch without changing the user's enabled intent. The existing disable action stops work. No separate scheduling switch is introduced.

# Presentation

Installation review shows the localized cadence for interval entries. Method identity, exact period and execution budget remain inside existing expandable technical details. Installed details consume the authoritative background_interval projection: scheduled, running, stopped or blocked, with next-run time only while scheduled. A prior failed or unknown result remains visible without a retry button that could replay effects. A previous background diagnostic cannot override current interval status; separate process diagnostics remain available. Refresh uses the existing owner-scoped inventory path.

# Boundaries

The platform owns durable plans, claims, authorization fencing, dispatch, cancellation, recovery and schema migration. Redeven owns only its product policy, localized review/status, and existing management controls. Business protocol state remains application-owned. See [Plugin platform integration](plugin-platform-integration.md), [Plugin process sessions](plugin-process-sessions.md), and [ReDevPlugin boundary](redevplugin-boundary.md).

# Evidence

- ReDevPlugin 3.11.0 publishes BackgroundModule.Policy, verified interval summaries and inventory status with the common Host/runtime contract.
- ReDevPlugin 3.11.1 authorizes declared environment-private storage from an active durable interval claim without an online management session, while public management calls retain session authorization. Failed interval diagnostics use the closed platform presentation contract.
- Redeven background_policy_adapter_test.go covers local/app effect caps, immutable policy snapshots, absent policy and cancellation without online sessions.
- Plugin inventory/security projections and PluginManagement browser tests cover authoritative state, declaration changes, technical disclosure and narrow/light/dark layouts.

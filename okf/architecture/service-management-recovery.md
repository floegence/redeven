---
type: Runtime Contract
title: Web Service management recovery
description: Keep service facts, user goals, resource cleanup, and management archives actionable across failures and Runtime restarts.
tags: [architecture, web-services, recovery, ui, persistence]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

- Authority: the Registry owns management records and lifecycle transactions; the Manager observes resources and determines actions; the Renderer presents that decision.
- Outcome: every service explains its current situation, the last operation's result, and an available next step in Activity and Workbench.
- Invariants: historical failures never determine current resource state; unavailable inspection never means absence; destructive effects require fresh ownership and explicit cleanup choices.
- Failure boundary: an administrator with a working Registry can detach even when the engine is offline. Detachment preserves resources and never claims that business processes stopped.

# Contract

## Facts and actions

`ServiceFacts` separates presence, ownership, runtime state, inspection completeness, resource references, and check time. Opening readiness remains independent in `ServiceView.opening`. `desired_state` records user intent. List refresh, startup recovery, Open, preflight, and execution share resource inspection; observation updates compare the instance snapshot before writing, preventing a delayed check from replacing newer state.

The backend supplies the row's status, problem code, primary action, and action capabilities. A healthy instance with a failed previous operation remains healthy. A stopped existing instance offers Start. An absent instance offers recovery review. Unavailable inspection and ownership conflicts offer inspection and resolution. An unfinished uninstall offers its remaining work. Frontend code never substitutes Retry or Restart for unavailable Start.

Stop records stopped intent and converges successfully when the exact instance is already absent. Start and Restart reject missing instances with a recovery requirement. Stop and uninstall use saved resource ownership; current template errors cannot disable all resource management. A failed Host maintenance hook may be bypassed only through an administrator's reviewed plan, and only for verified resources.

## Review and execution

`POST /managed-web-services/{id}/management-plans` returns current facts, blockers, the proposed path, cleanup choices, and `plan_digest`. Uninstall, detach, restoration, recreation, and hook bypass require that reviewed digest. Ordinary Start and Stop remain single actions. The operation endpoint rechecks permission, instance configuration revision, management state, resource identities, references, and transaction state. Its worker repeats plan verification before effects; changed facts require a refreshed review.

One drawer contains a current conclusion, resource facts, and recommended actions. Errors are readable without hover. Technical codes and operation identifiers are expandable diagnostics. Data and workspace deletion are independent choices, both off by default; the full workspace path is visible. Preserving blocked resources is an explicit choice that generates a new plan. Reference inspection lists running and stopped containers and links the existing container detail surface without stopping them.

Recovery of a verified existing instance restores management without creating business processes. Recreation requires confirmed absence, complete usable data, no external references, valid current inputs, and no conflicting active instance. Missing data requires reinstall wording. Shared data directs the user to its references or a new independent installation after the old management record is archived. Settings can expose and repair missing parameters before execution validation succeeds; archived configuration changes use the existing reconfigure journal without touching the external runtime. Existing unrelated lifecycle transactions cannot be overwritten by recovery.

The public install endpoint requires a reviewed plan. Install review allocates a random instance ID and displays its final workspace before confirmation. A changed template, input, directory identity, or expired plan invalidates confirmation. Instance-scoped allocation and legacy resource boundaries are owned by [Service resource ownership](service-resource-ownership.md).

## Uninstall transaction

Uninstall uses `runtime_manifest_json`, the existing operation coordinator, and the existing event stream. Its journal records the confirmed runtime identity, cleanup choices, original operation, each resource's identity and result, and whether irreversible cleanup occurred. All selected resources are inspected before stopped intent or external deletion. Known blockers cause no business mutation.

Execution persists intent, stops the verified business instance, removes runtime resources, and then handles each selected volume, network, and directory. Each mutation has an executing record, a fresh identity/reference check, and a confirmed result. Timeouts leave results unresolved. A completed resource is not deleted again. A resource recreated under the same name cannot acquire the previous deletion authorization. Runtime restart reconciles actual facts; it never infers completion from a historical error code or automatically loops a failed user request.

Partial failure preserves the transaction and completed effects. The next reviewed uninstall resumes remaining items or explicitly retains them. Cancellation stops subsequent steps; it cannot undo data already deleted. A pre-existing update or reconfigure journal must be resolved through its own recovery path, not replaced by uninstall. Detachment remains available while it is unresolved.

## Management archives and access

Registry version 4 adds `active`, `detached`, and `uninstalled`. Only active records participate in template uniqueness and must own an authorized Forward. Detached records preserve configuration, private configuration, exact bindings, resources, and history. Automatic lifecycle work skips them. Uninstalled records remain only when resources are retained, and private installation values and opening state are cleared. Active records, detached records, and retained data have separate list filters.

Detach is a local Registry transaction: archive the Forward description, remove the authorized route, and retain the service record. Existing proxy requests and upgraded streams are cancelled when that route is revoked. A stale Open cannot recreate access after detach. Recovery creates a fresh authorized Forward only after revalidating resource ownership and active-template uniqueness. Names, ports, or cached reachability never prove ownership.

# Boundaries

The contiguous `portforward_registry_v2` 3-to-4 migration preserves bindings, configuration, private-file references, operation history, and existing resource locations. It rebuilds constraints atomically and verifies both exact schema shapes. Historical failed uninstall is a request for inspection, not evidence that any specific item was deleted. Failed migration rolls back completely; unknown versions and structural drift remain read-only failures. TemplateSpec remains v6. Desktop/Runtime compatibility epoch 15 covers these management contracts.

# Evidence

- `redeven:internal/managedwebservice/management_facts.go` - Structured observation and reference facts.
- `redeven:internal/managedwebservice/management_plan.go` - Reviewed action selection and digest validation.
- `redeven:internal/managedwebservice/management_uninstall.go` - Durable per-resource uninstall results and resumption.
- `redeven:internal/portforward/registry/migrate_management.go` - Atomic schema 3-to-4 migration.
- `redeven:internal/portforward/registry/access.go` - Immediate revocation of existing route access.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceManagementDrawer.tsx` - Shared recovery and uninstall review.
- `redeven:internal/managedwebservice/management_recovery_test.go` - Missing, offline, shared-resource, stale-plan, and interrupted-cleanup cases.
- `redeven:internal/codeapp/appserver/managed_route_revocation_test.go` - Actual upgraded socket revocation.
- `redeven:internal/managedwebservice/management_settings_test.go` - Repairing missing private inputs without starting an archived instance.

- `redeven:internal/managedwebservice/management_docker_integration_test.go` - Real Docker instances in separate state directories and process termination between external deletion and journal commit.

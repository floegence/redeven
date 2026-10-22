---
type: Runtime Contract
title: Web Service management recovery
description: Keep service facts, user goals, resource cleanup, and management archives actionable across failures and Runtime restarts.
tags: [architecture, web-services, recovery, ui, persistence]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the Registry owns management records and lifecycle transactions; the Manager observes resources and determines actions; the Renderer presents that decision.
- Outcome: every service explains its current situation, the last operation's result, and an available next step in Activity and Workbench.
- Invariants: historical failures never determine current resource state; unavailable inspection never means absence; destructive effects require fresh ownership and explicit cleanup choices.
- Failure boundary: an administrator with a working Registry can detach even when the engine is offline. Detachment preserves resources and never claims that business processes stopped.

# Contract

## Facts and actions
`ServiceFacts` separates presence, ownership, runtime state, inspection completeness, resource references, and check time.

Frontend code never substitutes Retry or Restart for unavailable Start.

A failed Host maintenance hook may be bypassed only through an administrator's reviewed plan, and only for verified resources.

## Review and execution
`GET /managed-web-services/{id}/inspection` requires read permission, is non-cacheable, and uses the same factual backend projection as the list.

Existing unrelated lifecycle transactions cannot be overwritten by recovery.

Instance-scoped allocation and legacy resource boundaries are owned by [Service resource ownership](service-resource-ownership.md).

## Uninstall transaction
Uninstall uses `runtime_manifest_json`, the existing operation coordinator, and the existing event stream.

A resource recreated under the same name cannot acquire the previous deletion authorization.

Detachment remains available while it is unresolved.

## Management archives and access
Registry version 4 adds `active`, `detached`, and `uninstalled`. Only active records participate in template uniqueness and must own an authorized Forward.

Names, ports, or cached reachability never prove ownership.

# Boundaries

The contiguous `portforward_registry_v2` 3-to-4 migration preserves bindings, configuration, private-file references, operation history, and existing resource locations. Failed migration rolls back completely; unknown versions and structural drift remain read-only failures. Desktop/Runtime compatibility epoch 15 covers these management contracts.

# Evidence

- `redeven:internal/managedwebservice/management_facts.go` - Structured observation and reference facts.

- `redeven:internal/managedwebservice/management_plan.go` - Reviewed action selection and digest validation.

- `redeven:internal/managedwebservice/management_uninstall.go` - Durable per-resource uninstall results and resumption.

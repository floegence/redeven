---
type: Runtime Contract
title: Web Service management recovery
tags: [architecture, web-services, recovery, ui, persistence]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Registry owns lifecycle records/transactions; Manager observes resources and available actions; Renderer presents current state, last result and next step. Unavailable inspection is not absence; historical failure is not current state. Destruction requires fresh ownership/explicit cleanup. Authorized detach works with an offline engine but preserves resources and claims no process stop.

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

- `redeven:internal/managedwebservice/management_uninstall.go` - Durable per-resource uninstall results and resumption.

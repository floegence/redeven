---
type: Runtime Contract
title: Service management recovery and resource ownership
tags: [architecture, web-services, recovery, ui, persistence]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Registry owns transactions, allocations and identities; fresh backend facts govern recovery and deletion. Unknown ownership is shown honestly. Frontend code never substitutes Retry or Restart for unavailable Start. A failed Host maintenance hook may be bypassed only through an administrator's reviewed plan, and only for verified resources.

# Contract

## Management recovery
### Facts and actions
`ServiceFacts` separates presence, ownership, runtime state, inspection completeness, resource references, and check time.

### Review and execution
`GET /managed-web-services/{id}/inspection` requires read permission, is non-cacheable, and uses the same factual backend projection as the list.

Existing unrelated lifecycle transactions cannot be overwritten by recovery.

Instance-scoped allocation and legacy resource boundaries are owned by [Service resource ownership](#resource-ownership).

### Uninstall transaction
Uninstall uses `runtime_manifest_json`, the existing operation coordinator, and the existing event stream.

A resource recreated under the same name cannot acquire the previous deletion authorization.

Detachment remains available while it is unresolved.

### Management archives and access
Registry version 4 adds `active`, `detached`, and `uninstalled`. Only active records participate in template uniqueness and must own an authorized Forward.

Names, ports, or cached reachability never prove ownership.

## Resource ownership
### Instance allocation
New Host bindings use `instances/<service-id>/data`.

Creation must return the expected service, resource, and generation labels plus native identity.

Template permissions remain unchanged: unsupported external Compose capabilities are still rejected by template policy.

### Observation and deletion
Container ownership uses exact native ID, standard managed name, and service label.

Reference metadata exposes selected container identity, state, ports, and owning service identifiers; arbitrary engine labels and injected secrets never become public inventory fields.

# Boundaries

The contiguous `portforward_registry_v2` 3-to-4 migration preserves bindings, configuration, private-file references, operation history, and existing resource locations. Failed migration rolls back completely; unknown versions and structural drift remain read-only failures. Desktop/Runtime compatibility epoch 15 covers these management contracts.

Existing volume names and directories are not renamed, moved, or recreated during schema upgrade. Uninstall defaults to retaining data and workspace, and cannot remove another container to satisfy a cleanup request. The [management recovery contract](#management-recovery) owns confirmation, journal resumption, archive navigation, and explicit preservation.

# Evidence

- `redeven:internal/managedwebservice/management_facts.go` - Source.

---
type: Runtime Contract
title: Service resource ownership
description: Allocate isolated instance resources and verify exact ownership before reuse or deletion without moving legacy application data.
tags: [architecture, web-services, containers, storage, security]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Registry records allocations/identity; engine/filesystem inspection proves current facts. Instances across Runtime state roots get independent default data/workspaces. Names grant no ownership; stopped containers count. External/unverified legacy resources cannot become deletable. Uncertainty preserves resources for review; upgrades never move/copy running data.

# Contract

## Instance allocation
New Host bindings use `instances/<service-id>/data`.

Creation must return the expected service, resource, and generation labels plus native identity.

Template permissions remain unchanged: unsupported external Compose capabilities are still rejected by template policy.

## Observation and deletion
Container ownership uses exact native ID, standard managed name, and service label.

Unknown ownership is shown honestly. Reference metadata exposes selected container identity, state, ports, and owning service identifiers; arbitrary engine labels and injected secrets never become public inventory fields.

# Boundaries

Existing volume names and directories are not renamed, moved, or recreated during schema upgrade. Uninstall defaults to retaining data and workspace, and cannot remove another container to satisfy a cleanup request. The [management recovery contract](service-management-recovery.md) owns confirmation, journal resumption, archive navigation, and explicit preservation.

# Evidence

- `redeven:internal/managedwebservice/runtime_binding.go` - Instance-scoped bindings and preserved legacy locations.

- `redeven:internal/managedwebservice/runtime_resource.go` - Durable container allocation and lost-response verification.

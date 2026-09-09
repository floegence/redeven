---
type: Runtime Contract
title: Service resource ownership
description: Allocate isolated instance resources and verify exact ownership before reuse or deletion without moving legacy application data.
tags: [architecture, web-services, containers, storage, security]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

- Authority: the Registry records resource allocations and identities; engine and filesystem inspection establish current facts.
- Outcome: separate instances, including installations in separate Runtime state directories, receive independent default data and workspace resources.
- Invariants: names alone never confer ownership; stopped containers count as references; external resources and unverified legacy assets cannot become implicitly deletable.
- Failure boundary: inspection or identity uncertainty preserves resources and directs users to the management review. No running data is moved or copied during upgrade.

# Contract

## Instance allocation

New Host bindings use `instances/<service-id>/data`. New default workspaces include the randomly allocated service ID. Existing bindings remain unchanged, including former family directories. A user-selected directory keeps its external ownership semantics and receives no automatic deletion authority.

Container volume names include the instance and resource IDs. Before engine creation, a durable allocation records the proposed name and a random generation. Creation must return the expected service, resource, and generation labels plus native identity. The returned container ID is persisted before launch. A lost create response can be recovered by the pending allocation proof, never by matching a name alone. The resource table remains the sole inventory; allocation entries are removed after verified resource records replace them.

Compose generated configuration scopes projects, volumes, and networks to the instance. Declared data volumes use the same owned volume allocator as Container, and generated Compose YAML references them externally so removing runtime containers cannot implicitly delete data. Generated container and network labels include a random allocation generation. The private configuration digest and generation are persisted before Compose creates resources. Start only starts existing verified containers; it never implicitly recreates them with `up`. Template permissions remain unchanged: unsupported external Compose capabilities are still rejected by template policy.

## Observation and deletion

Container ownership uses exact native ID, standard managed name, and service label. Image or runtime-configuration drift is a separate configuration issue, not evidence that ownership changed. Compose checks the saved configuration identity, exact project membership, service labels, and the allocation generation when available.

Volume proof combines stored name, creation identity, and allocation labels for new resources. Networks retain the exact network ID. Directory proof uses native device, inode, and birth identity where available. A changed identity, symlink, unsafe scope, overlapping managed path, or incomplete inspection prevents destructive cleanup.

Resource checks inspect actual engine references, including stopped containers and bind mounts outside the current Runtime's Registry. Unknown ownership is shown honestly. Reference metadata exposes selected container identity, state, ports, and owning service identifiers; arbitrary engine labels and injected secrets never become public inventory fields.

# Boundaries

Existing volume names and directories are not renamed, moved, or recreated during schema upgrade. Legacy resources remain unverified until their evidence is sufficient. Uninstall defaults to retaining data and workspace, and cannot remove another container to satisfy a cleanup request. The [management recovery contract](service-management-recovery.md) owns confirmation, journal resumption, archive navigation, and explicit preservation.

# Evidence

- `redeven:internal/managedwebservice/runtime_binding.go` - Instance-scoped bindings and preserved legacy locations.
- `redeven:internal/managedwebservice/install_plan.go` - Final workspace review and stale-directory rejection.
- `redeven:internal/managedwebservice/runtime_resource.go` - Durable container allocation and lost-response verification.
- `redeven:internal/managedwebservice/volume_allocation.go` - Volume allocation generations and recovery.
- `redeven:internal/managedwebservice/compose_network_inventory.go` - Exact network inventory and references.
- `redeven:internal/containerengine/networks.go` - Running and stopped engine network references.
- `redeven:internal/managedwebservice/management_directory_linux.go` - Native directory birth identity.
- `redeven:internal/managedwebservice/management_directory_darwin.go` - Raw macOS directory birth identity.

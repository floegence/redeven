---
type: Runtime Contract
title: Runtime Service snapshot
description: Runtime identity, independent compatibility, access readiness, workload inventory, and optional Gateway supervision.
tags: [architecture, desktop, runtime-service, compatibility]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

The Runtime Service snapshot is a typed boundary between Runtime, Desktop, Local UI, and optional Gateway supervision. Runtime protocol/version, compatibility epoch, capabilities, service readiness, and workload identity are explicit facts. Gateway is optional for Runtime startup and ordinary access; its absence only closes Redeven-managed lifecycle actions.

# Contract

Runtime publishes its own service protocol and independent component version. Gateway compatibility is negotiated by protocol, epoch, capability set, signed manifest, and Runtime artifact digest; equal version strings are not required. A missing or incompatible Gateway fails closed only for lifecycle management. Runtime Connect, Workspace, terminal, files, web, and Runtime UI remain available according to their own gates.

The snapshot includes target identity, generation-bound workload/process inventory, snapshot revision, inventory digest, lifecycle fence state, and typed `unknown` values when inventory is unavailable or malformed. A supervisor can begin/release a fence and perform token-bound shutdown, but Runtime does not create Gateway operations, permits, locks, or recovery records. Fence release requires the exact token while a fence is active. After a successful replacement starts a new Runtime process with no inherited fence, releasing the consumed non-empty token is idempotent so Gateway can persist the operation outcome without manufacturing cross-process Runtime state. External OS maintenance is outside the product lifecycle authority; the next Gateway enablement revalidates identity, protocol, epoch, capabilities, and digest.

# Boundaries

Portal `ControlChannelFence` fields protect the Provider control channel and are distinct from Gateway `target_generation`. Neither counter is a Desktop ownership marker. The Runtime Service has no hidden v1 lifecycle-owner fallback and does not require a Gateway endpoint, pairing, or operation store to start.

# Evidence

- `redeven:internal/runtimeservice/snapshot.go:1` - Runtime Service snapshot and independent protocol identifier.
- `redeven:internal/runtimeservice/compatibility.go:1` - Signed/embedded Runtime compatibility contract.
- `redeven:internal/runtimeservice/lifecycle.go:1` - Optional lifecycle fence and supervisor-facing identity.
- `redeven:internal/runtimemanagement/process_inventory.go:1` - Exact workload identity and unknown inventory behavior.
- `redeven:internal/localui/runtime_control.go:1` - Ordinary Runtime control remains a local Runtime interface.

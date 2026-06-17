---
type: Runtime Contract
title: Runtime Service snapshot
description: Runtime Service snapshots describe compatibility, open readiness, workload, capabilities, and Desktop/runtime bindings.
tags: [architecture, desktop, runtime-service, compatibility]
timestamp: 2026-06-17T00:00:00Z
---

The Runtime Service snapshot is Redeven's typed compatibility and readiness surface between the endpoint runtime, Desktop, Local UI, and provider-facing environment catalogs.

# Mechanism

The Go runtime defines protocol version `redeven-runtime-v1`, owner states, compatibility states, open-readiness states, workload counts, runtime-control capabilities, Desktop model source binding state, and provider-link binding state. Normalization trims and defaults partial snapshots, applies endpoint facts such as Desktop ownership and effective run mode, infers open readiness from compatibility when missing, and blocks otherwise-open snapshots when the Env App shell is unavailable. The release compatibility contract is embedded and applied to snapshots.

# Boundaries

Consumers should use `open_readiness` and capability bindings rather than infer readiness from version strings or Desktop-only conditions. Protocol compatibility remains controlled by the embedded compatibility contract.

# Citations

[1] redeven:internal/runtimeservice/snapshot.go:8 - Runtime Service protocol version is `redeven-runtime-v1`.
[2] redeven:internal/runtimeservice/snapshot.go:123 - Snapshot fields include version, owner, compatibility, readiness, workload, capabilities, and bindings.
[3] redeven:internal/runtimeservice/snapshot.go:144 - Endpoint normalization applies Desktop-managed facts and effective run mode.
[4] redeven:internal/runtimeservice/snapshot.go:180 - Snapshot normalization defaults protocol, owner, compatibility, readiness, counts, capabilities, and bindings.
[5] redeven:internal/runtimeservice/snapshot.go:323 - Open readiness is normalized and inferred from compatibility when absent.
[6] redeven:internal/runtimeservice/snapshot.go:346 - Update-required, Desktop-update-required, and managed-elsewhere states block opening.
[7] redeven:internal/localui/localui.go:1043 - Local UI exposes the agent Runtime Service snapshot after endpoint normalization.
[8] redeven:internal/localui/localui.go:1051 - Missing Env App shell forces an `env_app_shell_unavailable` open-readiness block.
[9] redeven:internal/runtimeservice/compatibility.go:11 - The compatibility contract JSON is embedded in the runtime.
[10] redeven:internal/runtimeservice/compatibility.go:142 - Applying the compatibility contract stamps protocol, epoch, minimum versions, review id, and compatibility.

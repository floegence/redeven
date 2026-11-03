---
type: Runtime Contract
title: Runtime Service snapshot
tags: [architecture, desktop, runtime-service, compatibility]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Typed Runtime snapshots expose protocol/version, compatibility epoch, capabilities, readiness and workload identity to Desktop/Local UI. Gateway attachment is optional routing, never a prerequisite for independent access or authenticated host lifecycle management.

# Contract

Runtime publishes its own service protocol and independent component version. Desktop manages Runtime lifecycle through its verified target-host connection, placement bridge and lifecycle coordinator. Gateway manages neither Runtime processes nor their lifecycle admission.

Runtime snapshot fields and generated wire schemas change together; an unknown response key must not turn a healthy Runtime into a reconnect loop.

Compatibility epoch 35 requires both Desktop and Runtime to understand explicit reasoning `on` alongside the existing default, off, effort, and budget choices. Earlier clients reject `on`; ordinary epoch admission prevents a mixed pair from accepting a Flower or Desktop model-source request it cannot interpret. See the [reasoning selection contract](../ui/flower-reasoning-selection.md) for model capability and control semantics.

Epoch 59 pairs Runtime authorization requests with the shared Desktop and Env App OpenAI account picker. A saved registry requires an account selection or explicit new-registration intent; old Desktop clients must update before Flower access. Registration semantics belong to the [ChatGPT account lifecycle](../ai/chatgpt-account-lifecycle.md).

Epoch 65 requires the model directory's backend-owned default_fetch_source field in provider search policies. See [model web search](../ai/model-web-search.md).

Epoch 67 requires complete changed pin metadata in Flower pin confirmations. New pins append to the endpoint's existing order; Desktop and Runtime must agree on the changed ranks and revisions before a confirmation is accepted. See [sidebar pin ordering](../ui/flower-thread-sidebar.md).

Epoch 71 requires truthful per-attachment Gateway connection phases and a collection-only owner status API. Durable joining/joined/removal state is separate from live controller observations. A stopped Runtime cannot report a connected attachment. The shared projection, strict Desktop admission and independent Gateway epoch are defined by [Gateway interactions](../gateway/gateway-desktop-interactions.md).

# Boundaries

Portal control-channel fences protect Provider authorization. Gateway attachment versions fence only their corresponding attachment and transport authority. The Runtime Service has no hidden v1 lifecycle-owner fallback and does not require a Gateway endpoint, pairing, or operation store to start.

# Evidence

- `redeven:internal/runtimeservice/snapshot.go:1` - Source.
- `redeven:internal/runtimeservice/workload.go:1` - Source.

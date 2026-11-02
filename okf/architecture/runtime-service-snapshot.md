---
type: Runtime Contract
title: Runtime Service snapshot
tags: [architecture, desktop, runtime-service, compatibility]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

The Runtime Service snapshot is a typed boundary between Runtime, Desktop and Local UI. Runtime protocol/version, compatibility epoch, capabilities, service readiness and workload identity are explicit facts. Gateway attachments are optional access paths; their absence never disables independent Runtime access or host-authorized lifecycle management.

# Contract

Runtime publishes its own service protocol and independent component version. Desktop manages Runtime lifecycle through its verified target-host connection, placement bridge and lifecycle coordinator. Gateway manages neither Runtime processes nor their lifecycle admission.

Runtime snapshot fields and generated wire schemas change together; an unknown response key must not turn a healthy Runtime into a reconnect loop.

Compatibility epoch 35 requires both Desktop and Runtime to understand explicit reasoning `on` alongside the existing default, off, effort, and budget choices. Earlier clients reject `on`; ordinary epoch admission prevents a mixed pair from accepting a Flower or Desktop model-source request it cannot interpret. See the [reasoning selection contract](../ui/flower-reasoning-selection.md) for model capability and control semantics.

Epoch 59 pairs Runtime authorization requests with the shared Desktop and Env App OpenAI account picker. A saved registry requires an account selection or explicit new-registration intent; old Desktop clients must update before Flower access. Registration semantics belong to the [ChatGPT account lifecycle](../ai/chatgpt-account-lifecycle.md).

Epoch 65 requires the model directory's backend-owned default_fetch_source field in provider search policies. See [model web search](../ai/model-web-search.md).

Epoch 67 requires complete changed pin metadata in Flower pin confirmations. New pins append to the endpoint's existing order; Desktop and Runtime must agree on the changed ranks and revisions before a confirmation is accepted. See [sidebar pin ordering](../ui/flower-thread-sidebar.md).

# Boundaries

Portal control-channel fences protect Provider authorization. Gateway attachment versions fence only their corresponding attachment and transport authority. The Runtime Service has no hidden v1 lifecycle-owner fallback and does not require a Gateway endpoint, pairing, or operation store to start.

# Evidence

- `redeven:internal/runtimeservice/snapshot.go:1` - Runtime Service snapshot and independent protocol identifier.

- `redeven:internal/runtimeservice/workload.go:1` - Workload admission/leases/revisions and supervisor impact.

---
type: Gateway Contract
title: Gateway Cloud access
tags: [gateway, cloud, security, networking, identity]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Gateway Cloud v3 manages a Gateway machine and its local directory. RCPP v5 independently enrolls and recovers a Runtime over either direct HTTPS or the selected Gateway proxy. Gateway local v6 owns membership, invitations and restricted egress. Cloud owns environment identity, Namespace ownership and approval. Runtime owns one Cloud association, one selected route and one Flowersec connection controller.

# Contract

## Independent approval and membership
Joining a Gateway establishes local membership only. A directory cannot obtain Runtime credentials.

Namespace authorization, local egress permission and batch-enrollment delegation are separate decisions.

## Required network path
Runtime control registration, independent recovery, data transport and enabled official-platform requests use the explicitly selected route. Gateway outages and denied egress never trigger a direct Internet fallback or global proxy environment variables.

Ownership changes require separate authorization.

## One recovery owner
Registration, heartbeat and credential replenishment share one connection controller and independent credential source.

Unknown results resume that operation.

Each route operation can be queried after an unknown result; cancellation reports a committed operation truthfully.

## Management notifications and closure
Each Gateway has one authenticated HTTPS notification owner. Reconnection starts with an authoritative snapshot.

No short data lease is introduced during ordinary control outages.

# Boundaries

One connection controller owns Runtime Cloud execution. Unknown or retired configuration is rejected read-only and requires explicit new configuration and registration. Released upstream Flowersec supplies HTTPS proxy, credential source, notifications and retry control; local sibling dependency wiring is prohibited.

# Evidence

- `redeven:internal/runtimecloud/protocol/contracts.go` — Mirrored independent identity, binding, recovery and route DTOs.

- `redeven:internal/gatewaycloud/protocol/testdata/wire-v3.json` — Shared machine-management wire fixture.

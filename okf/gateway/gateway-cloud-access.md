---
type: Gateway Contract
title: Gateway Cloud access
description: Separate restricted network routes from independent Runtime Cloud authorization and recovery.
tags: [gateway, cloud, security, networking, identity]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Gateway Cloud v3 manages a Gateway machine and its local directory. RCPP v5 independently enrolls and recovers a Runtime over either direct HTTPS or the selected Gateway proxy. Gateway local v6 owns membership, invitations and restricted egress. Cloud owns environment identity, Namespace ownership and approval. Runtime owns one Cloud association, one selected route and one Flowersec connection controller.

# Contract

## Independent approval and membership

Joining a Gateway establishes local membership only. Initial Namespace enrollment requires an explicit delegation, current Namespace batch approval and the Runtime's own machine proof. A directory cannot obtain Runtime credentials. User enrollment uses a setup ticket with the same proof and Region credential delivery. The approving administrator is an audit actor; leaving the organization does not revoke a Namespace-owned machine approval.

A CloudRuntimeBinding records Runtime, environment, Cloud, Namespace, owner kind, binding generation and the independent identity key and expiry. Gateway directory versions and egress policy are not continuing Cloud authorization conditions. Denying Gateway egress, removing a member or revoking Gateway management access leaves existing Cloud approval and environments intact. Cloud revocation leaves independent local Gateway membership intact.

Formal environment names remain Cloud-owned. Gateway names and observed connectivity cannot overwrite or infer Cloud ownership. Joining an unrelated member, changing an unrelated address or removing an unrelated Gateway does not alter the selected Cloud route or association. Namespace authorization, local egress permission and batch-enrollment delegation are separate decisions.

## Required network path

Runtime control registration, independent recovery, data transport and enabled official-platform requests use the explicitly selected route. Gateway resolves only approved Cloud, Region and Tunnel destinations. Runtime checks inner destination TLS independently of Gateway authentication. Gateway outages and denied egress never trigger a direct Internet fallback or global proxy environment variables. Custom Tunnel approval and billing boundaries remain unchanged.

An existing association changes route through a preflight operation with an original operation ID and expected route revision. Preflight verifies membership and destination TLS without stopping the current connection. Confirmation atomically saves the new selection, cancels the old owner, closes old-route Cloud sessions and starts the new controller. Background tasks continue. A committed route stays selected if reconnection fails; users can retry or explicitly choose another route. Ordinary route changes preserve environment ID, ownership and binding generation. Ownership changes require separate authorization.

## One recovery owner

Registration, heartbeat and credential replenishment share one connection controller and independent credential source. Online Runtime does not poll runtime-status or acquire recurring status challenges. Without a control channel, the same source checks approval or depleted-pool recovery every thirty seconds with a dispersed initial phase. Revoked or pending bindings query state without connecting with old credentials. Identity expiry and protocol errors require explicit action.

An unfinished setup enrollment durably retains the original operation ID and machine key. Unknown results resume that operation. `redeven cloud enrollment status` displays only safe coordinates; cancel stops local attempts without discarding recovery identity or changing Cloud approval. Resume uses signed recovery of the original operation without another setup ticket. Late results cannot save a cancelled enrollment. A saved success with a remaining journal never overwrites spent credentials or newer settings.

Desktop, CLI and the local owner page expose the same approval, connection and route facts. `redeven cloud manage` serves a short-lived loopback page, admitted by a private owner capability, with fixed operations over the owner-only socket. This authority is absent from ordinary Cloud and Gateway application surfaces. Each route operation can be queried after an unknown result; cancellation reports a committed operation truthfully.

## Management notifications and closure

Each Gateway has one authenticated HTTPS notification owner. Directory changes coalesce; unchanged calibration does not upload the full directory. Reconnection starts with an authoritative snapshot. Versioned notifications fence stale state; commands retain persistent IDs and idempotent results. Fifteen-second transport keepalives create no challenges or database writes. Sixty-second calibration rechecks versions. Slow consumers and expired identities close the bounded stream without holding a database connection while waiting.

Cloud revocation disables signing and recovery immediately. Runtime closes sessions matching the binding and generation, persists its closure receipt and delivers it through the fixed signed closure-ack endpoint. Gateway is not a second required confirmer of Runtime closure. Gateway confirms only its own local forwarding operations. A disconnected control channel or network partition never proves business-session closure. No short data lease is introduced during ordinary control outages.

# Boundaries

One connection controller owns Runtime Cloud execution. Management notifications do not grant Runtime Cloud access. Unknown or retired configuration is rejected read-only and requires explicit new configuration and registration. Released upstream Flowersec supplies HTTPS proxy, credential source, notifications and retry control; local sibling dependency wiring is prohibited.

# Evidence

- `redeven:internal/runtimecloud/protocol/contracts.go` — Mirrored independent identity, binding, recovery and route DTOs.
- `redeven:internal/gatewaycloud/protocol/testdata/wire-v3.json` — Shared machine-management wire fixture.
- `redeven:internal/agent/cloud_route_test.go` — Preflight, idempotent commit, cancellation and owner fences.
- `redeven:internal/config/bootstrap_test.go` — Lost enrollment results, ticket expiry, suspended late saves and restored journals.
- `redeven:internal/agent/runtime_cloud_closure_test.go` — Durable Runtime closure receipts.
- `redeven:internal/gatewaycloud/gateway.go` — Machine management notification owner.
- `redeven:cmd/redeven/cloud_manage_test.go` — Scoped owner UI authority and exact operation forwarding.

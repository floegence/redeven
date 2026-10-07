---
type: Gateway Contract
title: Gateway Cloud access
description: Publish unified members with Namespace authorization and independent Runtime credentials.
tags: [gateway, cloud, security, networking, identity]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Gateway Cloud v2 projects the single local member directory into Cloud. Runtime independently proves its identity and receives its own credentials through restricted HTTPS CONNECT, preserving inner Cloud TLS. Namespace owns publication and access approval; the approving administrator is only an audit actor. Manual and authorized automatic publication share one binding transaction. Control service outages do not introduce timers that terminate existing data sessions.

# Contract

## Publish a member

Gateway binds to one Cloud and Namespace using a stable machine claim and a separate rotating Cloud identity. The local member delegation permits later publication without a second local Cloud enrollment. Gateway policy, independent Runtime proof and versioned directory observation must all agree. Cloud challenges bind purpose, Cloud, Namespace, Gateway, Runtime, expiry and binding generation. Only an authenticated Gateway directory observation allocates a candidate member slot. Initial Runtime proof waits for that observation; retries do not allocate unobserved candidates. Historical unobserved proofs retain their evidence but consume no member or egress capacity. Directory metadata alone cannot create an environment or obtain Runtime credentials.

Manual mode exposes eligible candidates to Namespace administrators. Automatic mode also requires an explicit Namespace grant for that Gateway; a local mode switch cannot grant it. Both modes use the same idempotent publication and credential delivery business logic. Explicit unpublication is never automatically reversed. Cloud-generated invitations are commands to an online Gateway; Cloud cannot mint a second local membership credential.

Formal environment identity and display names remain Metaserver-owned. Gateway metadata does not overwrite a Cloud name. Cloud lists read a durable projection with monotonic directory and policy revisions. Missing directory entries, sync failure and Gateway downtime never delete environments. Member connectivity, control registration and each user's current access permission remain distinct.

## Required network path

Runtime control registration, credential recovery, data transport and enabled official-platform AI requests use the sole member's explicit proxy path. Gateway resolves approved Cloud, Region and Tunnel destinations. Runtime validates the inner destination TLS certificate. Unsupported transport candidates are removed before dialing; Gateway failure never falls back to direct Internet or global proxy environment variables. Custom Tunnel destinations require existing authoritative approval and billing rules. User programs' general egress is outside this contract.

## Recovery, replacement and migration

Control credentials are replenished normally. After depletion the dedicated Runtime Cloud identity can recover only the same approved binding after Cloud rechecks Gateway, Namespace, environment, membership and generation. Changes to the member certificate, private key, Gateway address or pinned CA cancel the control owner so its existing observer can create a controller with the new explicit route. Bookkeeping writes do not restart it, and independent data sessions remain open. Administrator departure does not revoke Namespace-owned approval. Expired machine identities do not serve as fallback credentials.

Changing Gateway is explicit. Preserving `env_public_id` requires proof of the original binding and a new locally confirmed member delegation. Ordinary user-to-Namespace conversion additionally requires current user binding confirmation and displays ownership transfer. Cross-Namespace name, address or public-health matches never merge environments. A successful transition advances generation and disables old-path recovery.

The cutover fences old Cloud-only configurations and marks retained Cloud records as requiring rejoin. Old proof can remain only as migration evidence; it cannot start the retired access path. Without valid evidence, use explicit reauthorization or a new environment. Runtime Service compatibility epoch 41 and v2 Cloud contracts require matching clients.

## Revocation and truthful receipts

Cloud revocation transactionally disables new access issuance, pending credential delivery and recovery. Runtime cancels matching business sessions; Gateway closes matching Cloud forwarding. Each side reports an independent, durable, idempotent receipt. A disconnected control channel is not proof that data sessions closed. Until both receipts arrive, show which side remains pending.

Runtime retains a bounded terminal outbox after leaving. The receipt relay forwards only a fixed signed closure exchange to an exact current or historical Cloud/Namespace/Gateway association. It carries no old member certificate and cannot route arbitrary URLs or recover credentials. Historical receipt destinations are bounded; capacity exhaustion blocks further retirement instead of discarding pending evidence. A local persistence failure fences the running process and closes sessions but cannot acknowledge durable closure until persistence succeeds.

Gateway policy denial first fences local egress and records a durable denial revision. A later allow edit cannot erase that denial or release the fence. Directory delivery reports denial until Cloud commits it; the Gateway reads back the resulting binding projection before acknowledging the exact local denial revision. Lost responses and stale acknowledgements remain retryable. Allowing Cloud again does not republish a revoked binding. Network partition can leave already established sessions alive until their original expiry or connection end when neither endpoint receives revocation. No short authorization lease is added. Explicit removal, Cloud denial, unpublication, environment deletion and Gateway Cloud revocation have separate effects; none stops the Runtime process or background jobs.

# Boundaries

Namespace and Cloud own publication approval and formal environment identity; Gateway owns local membership and forwarding policy; Runtime owns its identity proof, credentials, and business sessions. This contract does not authorize direct Internet fallback, recreate a retired membership, or turn a control outage into a data-session lease.

# Evidence

- `redeven:internal/gatewaycloud/protocol/contracts.go` — Mirror of shared Gateway Cloud v2 DTOs.
- `redeven:internal/gatewaycloud/protocol/testdata/wire-v2.json` — Shared cross-repository wire fixture.
- `redeven:internal/gatewaycloud/gateway_denial_test.go` — Denial ordering, lost readback and explicit republication boundary.
- `redeven:internal/gatewaycloud/gateway.go` — Machine association and directory synchronization.
- `redeven:internal/agent/gateway_cloud_join.go` — Independent Runtime proof and credential delivery.
- `redeven:internal/agent/gateway_closure_delivery_test.go` — Durable receipts and disk-failure fencing.
- `redeven:internal/gatewaycloud/closure_relay_test.go` — Historical receipt destination confinement.
- `redeven:internal/config/gateway_migration.go` — One-time retired-state migration.
- `redeven:internal/gatewaycloud/product_isolation_test.go` — Real restricted-network acceptance fixture.

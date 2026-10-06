---
type: Gateway Contract
title: Gateway Cloud access
description: Connect an isolated Runtime to Cloud through an explicitly approved Namespace Gateway.
tags: [gateway, cloud, security, networking, identity]
timestamp: 2026-10-06T00:00:00Z
---
# Summary

Gateway Cloud v1 gives an isolated Runtime one explicitly configured Cloud path.
Runtime initiates mTLS HTTPS CONNECT to Gateway, retains an independent Cloud
identity, and verifies the destination's TLS inside the proxy. Namespace owns
publication; the approving administrator is an audit actor. Gateway cannot
create environments from directory entries or receive Runtime control
credentials. Cloud authorization and Flowersec business data remain separate.

A Gateway outage never enables public direct fallback. Network failure alone
does not revoke existing sessions. Revocation immediately blocks new Cloud
authorization and recovery, while durable independent receipts describe whether
Runtime and Gateway actually closed old sessions.

# Contract

## Identity and local consent

`redeven-gateway cloud-connect --cloud https://cloud.example.com --gateway-url https://gateway.internal:7443`
creates a dedicated machine identity and prints the Cloud approval page. The
administrator chooses a Namespace and Region there. `cloud-status` returns a
credential-free summary. Managed Desktop Gateway registrations provide the same
configuration, status, and browser handoff through their trusted host channel.
URL profiles cannot configure Cloud access.

Download a short-lived join file from that Gateway's Cloud page. Stop the target
Runtime and run `redeven gateway-join --material-file <file>`, adding
`--state-root <path>` for a nondefault Runtime. The command records local consent
before enrollment, persists progress, and waits for Cloud publication. The file
contains separate Gateway enrollment and Cloud join tokens; keep it private.
The Runtime's Cloud identity key and mTLS private key are independent.

Desktop also offers **Connect via Gateway** on trusted Runtime management
cards. Import the join file and explicitly agree. Closing the dialog pauses
polling without discarding consent; **Resume enrollment** continues the same
request. URL-only profiles cannot invoke this owner-authenticated operation.
Runtime Service compatibility epoch 39 declares this management capability;
Gateway Cloud itself uses independent protocol v1.

Runtime's signed Cloud proof and Gateway's directory observation must match the
same request, Runtime identity, and client certificate. Publication is a separate
Namespace administrator operation. A directory observation never substitutes
for local consent or Cloud proof. Published names and environment IDs are Cloud
authority. Missing entries and offline Gateways do not delete environments.

## Fixed transport path

The current released dependency is Flowersec v5.9.0. Its explicit HTTPS proxy
policy applies before one-time artifact spending and filters unsupported
transport candidates. Cloud enrollment, control, data, credential recovery, and
official platform AI use this configured path. Global proxy environment
variables, local dependency overrides, and public fallback are not part of it.

Gateway resolves destination DNS and permits only Cloud-approved exact HTTPS/WSS
authorities. It denies private, loopback, link-local and special destination IPs
in production. Arbitrary user program traffic is outside this capability.
Gateway caps pending plus established connections at 32 per Runtime and 1,024
overall, and copies opaque bytes with bounded buffers. Inner TLS authenticates
Cloud; Flowersec encrypts business sessions end to end.

One Gateway retains at most 1,024 active, enrolling or receipt-pending members.
Expired unused join files release capacity. Closure requests use 50-item pages;
pagination never replaces or truncates the complete forwarding policy.

Client and server leaf certificates last 90 days; the Runtime stages a new
private key and certificate before changing the Cloud-approved fingerprint.
Machine identities last one year and rotate while valid. An expired or revoked
identity requires explicit authorization; old credentials are never an expiry
fallback. The private Gateway root has a ten-year lifetime. Replacing that trust
root requires explicitly provisioning trust again.

## Recovery and explicit migration

Control credentials use the existing durable pool and spend ledger. Recovery
revalidates the same Namespace, Gateway, Runtime, environment and generation;
it neither creates a binding nor restores a revoked one. If a generation's
issuance budget is exhausted, a durable renewal intent advances that same path
once. A lost response resumes the same intent. Starting with an empty pool may
start authenticated recovery but cannot spend credentials or start sessions.

`redeven gateway-migrate --material-file <target-file>` requires a stopped
Runtime and a different Gateway in the same Cloud, Namespace and Region. Cloud
administrator approval and Runtime consent are both required. The existing
environment ID is preserved and generation advances. A user binding conversion
additionally proves its current control identity through Flowersec and explicitly
changes access ownership to Namespace. Names, addresses and public health proofs
are never merge evidence. Sessions may be interrupted.

After revocation, `redeven gateway-reauthorize --material-file <file>` requires
valid proof of the previous binding to preserve its environment ID. If that
proof is lost or expired, add `--new-environment`: administrator publication
creates a new Cloud environment and leaves the historical identity intact.
Local files and tasks are not deleted or merged by either operation.

To change the same Gateway's listener address, stop it and repeat `cloud-connect`
with the original state root and new `--gateway-url`, then restart. On each
stopped Runtime, `redeven gateway-address --gateway-url <origin>` verifies the
new address with the existing Gateway trust and identity before saving it.
An expired or revoked Gateway machine identity instead requires
`cloud-connect --reauthorize`, fresh Cloud approval and new Runtime consent.
These administrative address and reauthorization operations are CLI workflows.

## Revocation and reapproval

Unpublish disables new remote authorization and recovery, requests both sides
to close old sessions, and preserves the environment and local membership.
Publishing again requires a new explicit administrator decision for the current
revoked generation. Runtime retires old credentials before adopting it. An old
approval cannot undo a later unpublish.

Removing a member revokes its enrollment. Rejoining requires new join material
and local consent. Revoking a Gateway affects all its members. Deleting a Cloud
environment is a separate operation. None of these operations stops Runtime or
changes background task lifecycle.

Closure receipts are independent and durable. Gateway acknowledges only after
old-generation streams and pending dials drain. Runtime acknowledges only after
its remote sessions close. A network partition can leave existing sessions
alive until their original validity or connection end; there is no new short
lease. Cloud must display pending confirmation accurately, including after
migration or subsequent reapproval.

# Boundaries

Gateway Cloud grants no Runtime lifecycle authority. It does not provide
Gateway cascading, automatic failover, general-purpose network egress, or
automatic conversion of existing user bindings. Namespace authorization is
independent of each visiting user's access rights. Only authenticated closure
requests can cancel sessions; an authorization service outage cannot.

## Operational diagnostics

Gateway emits a structured `gateway_cloud_metrics` record every 30 seconds:
active connections, buffer budget, accepted/rejected totals, completed stream
upload/download byte totals, directory age and pending closures. Counters reset
on process restart; completed-byte totals exclude still-active streams. The
buffer budget reserves at most 64 KiB per active connection, including dials.
Cloud records operation, publication, recovery and connection-issuance outcomes
and latency. Logs contain only nonsecret identifiers and error classes.

# Evidence

- `internal/gatewaycloud/` owns persistent identity, enrollment, rotation and synchronization.
- `internal/gatewayegress/server.go` enforces mTLS CONNECT policy and resource bounds.
- `internal/agent/gateway_cloud.go` owns recovery, reapproval and Runtime closure receipts.
- `cmd/redeven/gateway_cloud.go` owns stopped-process local consent and migration.
- `internal/gatewaycloud/protocol/testdata/proof-v1.json` is the common signing fixture.
- `internal/gatewaycloud/protocol/testdata/wire-v1.json` freezes directory, publication and closure pagination payloads.
- `desktop/scripts/check-gateway-cloud-electron.mjs` exercises real consent through the trusted container placement bridge with a private Cloud qualification runner.
- `scripts/check_gateway_cloud_isolation.sh` verifies transport isolation; full Cloud/browser qualification lives in the Portal product fixture.

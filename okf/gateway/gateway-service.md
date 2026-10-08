---
type: Gateway Contract
title: Gateway service
description: Manage Runtime-initiated membership without acquiring Runtime lifecycle authority.
tags: [gateway, desktop, access, identity]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

`redeven-gateway` owns one durable member directory, invitations, paired Desktop permissions, policy and restricted forwarding. Runtime initiates membership and every member connection. Gateway never dials a Runtime address, scans a network, or installs, starts, stops, updates or resets a Runtime. LAN access works without Cloud. Gateway loss interrupts its network paths; independently authorized Runtime management remains separate.

# Contract

## Membership authority

A host administrator or a paired Desktop with `manage_members` creates a ten-minute, single-use invitation. A trusted Runtime management channel or local `redeven gateway join --invitation-file <file>` records consent before delivery. The Runtime signs delegation for this exact Gateway to manage LAN access and subsequent Cloud publication. A lost response recovers the original durable delivery; it cannot create another member.

Each Runtime has one Gateway membership. Startup reconnects the saved Gateway without prompting, switching Gateway, or falling back to a direct address. `replace` requires a fresh invitation and explicit local action. Gateway identity is a persisted machine key independent of its address. Each member has its own key, mTLS client certificate, service certificate and version. Credential rotation requires a currently valid identity; expired or revoked identity requires reauthorization.

The sole member store owns invitation consumption, membership, credentials, policy and revocation. Cloud refers to those members and cannot enroll them independently. Connection generation is a live observation, never an authorization source. Public health proof is useful only for display association.

## Policy and executable hooks

New installations deny Cloud by default. Each member inherits the default, explicitly allows Cloud, or explicitly denies Cloud. Changing the default affects all inherited members. Manual publication is the default. Automatic publication requires separate Namespace authorization in Cloud and uses the same binding transaction as manual approval.

Host-configured JSON hooks may further deny `member.admit`, `access.open` or `cloud.publish`. Programs use an absolute executable and argument array, never a shell. Versioned input contains only nonsecret identity, action and policy version. Invalid output, failure, a two-second timeout, more than 32 KiB output or the eight-process concurrency limit denies the operation. Stable reason codes are logged; raw script output is not. Desktop and Cloud can inspect status and request reevaluation but cannot install scripts or change their paths. Reevaluation applies policy changes without per-packet execution or periodic session leases. Cold startup reevaluates stored Cloud grants with the current executable configuration before installing any egress. Hook refresh immediately fences old Cloud grants in memory and notifies egress even if persistence fails; the denial survives in the authoritative state for the next successful write and directory acknowledgment. Cloud directory synchronization first persists that state and never sends a volatile policy revision. A changed denial becomes durable; unchanged results do not replay committed commands. Desktop member management and `redeven-gateway members reevaluate --member ID --version N` check the current member version before applying the same reevaluation.

## Own-process management

The separate Gateway archive and state root contain no Runtime lifecycle data. Desktop supports URL, local host, SSH host, local container and SSH container registrations. Host registrations expose explicit Gateway Start, Stop, Restart and Update through the existing lifecycle owner. Saving, refresh, pairing or member management never starts a stopped service implicitly.

Paired permissions are `access`, `manage_members` and `configure_cloud`. Managed transport is not an automatic permission grant. Host CLI administration uses a separate local credential. Adding member management or Cloud configuration to an existing pairing requires new consent.

Gateway updates prepare the complete package before stopping the existing service or replacing its Desktop bridge. A package preparation failure leaves both intact. Restart reuses a matching package; a stale package follows the same prepare-before-stop path. Source-built Gateway archives compile the standalone Gateway command without building Runtime frontend assets. Successful replacement retains the state root, Gateway identity, members and paired permissions. Preparation diagnostics retain a bounded redacted log head and tail so the compiler cause remains inspectable.

## Address changes and upgrade

Gateway listener bindings describe sockets on the device. Reachable connection endpoints describe the LAN, overlay or public addresses a Runtime can use, including DNS names and port-forwarded addresses that differ from those sockets. Administrators confirm and prioritize up to sixteen endpoints. Local interfaces are not automatically published, and deleted endpoints do not return after restart. With no confirmed endpoints, invitation creation is disabled.

The invitation signs the Gateway name, stable identity and endpoint set. Runtime keeps the most recently connected endpoint first, then administrator priority; a failed session tries another approved endpoint. If all fail, the membership stays intact and reports Gateway unavailable. Endpoint usage is recorded only after a Runtime session succeeds. A listening socket or configured public address does not prove remote reachability. No Cloud origin or listener binding is embedded in the invitation.

The host can update its listener and administrator-confirmed Runtime connection endpoints while retaining the Gateway identity and member CA. Runtime `update-endpoints` verifies a fresh invitation from the same pinned key and CA, using only its signed endpoint descriptor. It retains the existing member and Cloud association; a new identity requires `replace`. Desktop registration edits prove the pinned machine key with a fresh signed nonce before saving the new audience.

Existing single-address member state migrates to one endpoint without replacing the Gateway key, Runtime key, member credentials or Cloud binding. Old invitations must be recreated. Legacy Cloud-only enrollment without membership remains non-executable; see [Gateway Cloud access](gateway-cloud-access.md) for environment preservation.

Transport continues to use the published Flowersec implementation. The existing internal trust root covers the configured endpoint hostnames and IP addresses; administrators do not apply for a public certificate or configure TLS roots. Runtime users import an invitation and approve Gateway access. Optional Cloud publishing remains a separate flow.

# Boundaries

Gateway owns membership, policy, invitations, and restricted forwarding. Runtime remains the owner of its lifecycle, application authentication, and business sessions; Cloud remains the owner of Namespace approval and publication identity. Gateway never dials arbitrary Runtime addresses or turns observations into authority.

# Evidence

- `redeven:internal/gatewaymembership/store.go` — Sole durable membership and invitation delivery.
- `redeven:internal/gatewaymembership/hooks.go` — Bounded deny-only hook execution.
- `redeven:internal/gatewaymembership/address_test.go` — Address change preserves identity and rejects replacement keys.
- `redeven:internal/gatewaymembership/network_acceptance_test.go` — Real socket failover and endpoint removal with stable membership.
- `redeven:internal/gatewayservice/server.go` — Paired access and administration boundary.
- `redeven:cmd/redeven/gateway_membership.go` — Local membership commands.
- `redeven:desktop/src/main/gatewayLifecycleManager.ts` — Independent Gateway process owner.
- `redeven:desktop/scripts/check-gateway-local-update.mjs` — Real local update/restart, stable identity and failed-package service/bridge preservation.

## Operational observations

Structured `Gateway operation` log events expose `member.join`, `access.open`,
`cloud.sync`, and `cloud.recover` outcomes and `duration_ms`. Aggregate the outcome
counts for admission and recovery success rates and duration distributions for
reverse-stream opening and directory synchronization. These durations cover the
named operation, not complete application rendering. Error text and proof material
are excluded.

Every 30 seconds, `Gateway forwarding` reports the shared LAN/Cloud active budget,
including pending opens and uncompleted cancellation, cumulative admission counts,
and Cloud buffer budgets and completed byte counts. `Gateway Cloud projection`
reports directory age and the server's total pending closure count with its
observation timestamp. During an outage that timestamp stays stale; the backlog
must not be interpreted as a fresh zero. Counters reset when the Gateway restarts.

---
type: Gateway Contract
title: Gateway service
description: Manage Runtime-initiated membership without acquiring Runtime lifecycle authority.
tags: [gateway, desktop, access, identity]
timestamp: 2026-10-14T00:00:00Z
---
# Summary

`redeven-gateway` owns one durable member directory, one-time invitation-code consumption, client access grants, policy and restricted forwarding. Runtime verifies the Gateway address and code, previews the signed enrollment descriptor, then explicitly confirms membership. Gateway never dials a Runtime address, scans a network, or installs, starts, stops, updates or resets a Runtime. LAN access works without Cloud. Gateway loss interrupts its network paths; independently authorized Runtime management remains separate.

# Contract

## Membership authority

An administrator verified through the Gateway host creates a ten-minute, single-use invitation code and shares an administrator-confirmed Gateway address. A trusted Runtime management channel or local `redeven gateway join --gateway <address>` verifies the address and code, holds a short-lived read-only preview, and records consent only after explicit confirmation. The Runtime signs separate consent for LAN membership, Cloud egress and optional Namespace batch enrollment. Gateway never obtains Runtime Cloud credentials from its directory. A lost response recovers the original durable delivery; it cannot create another member. Regeneration cancels unconsumed older codes.

Local and Desktop startup persist the Runtime identity before exposing trusted management, including on a machine that has never connected to Cloud. Disconnecting Cloud disables the local connection intent and closes its sessions while retaining the independent Cloud association. Gateway memberships and Runtime identity remain intact. Connecting direct Cloud likewise preserves member progress, including credential updates completed during the Cloud exchange. Preview binds to that stable identity and does not initialize or mutate configuration.

Each Runtime can pair with up to sixteen Gateways. Each member owns its credentials, revision and reconnect controller. Adding a pairing changes neither existing members nor Cloud ownership. Startup reconnects every saved member independently without prompting or direct fallback. Targeted retry or removal affects only the chosen Gateway. The explicit `replace` command requires one current member, a fresh invitation and confirmation of connection interruption; adding another Gateway uses `join`. Gateway identity is a persisted machine key independent of its address. Each member has its own key, mTLS client certificate, service certificate and version. Credential rotation requires a currently valid identity; expired or revoked identity requires reauthorization.

The sole member store owns invitation consumption, membership, credentials, policy and revocation. Cloud can approve batch enrollment, but Runtime independently proves its registered identity before receiving credentials. Connection generation is a live observation, never an authorization source. Desktop display association uses the trusted Runtime management membership summary and the paired Gateway key; public health proof remains a separate observation and grants no authority.

## Policy and executable hooks

New installations deny Cloud by default. Each member inherits the default, explicitly allows Cloud, or explicitly denies Cloud. Changing the default affects all inherited members. Manual publication is the default. Automatic publication requires separate Namespace authorization in Cloud and uses the same binding transaction as manual approval.

Host-configured JSON hooks may further deny `member.admit`, `access.open` or `cloud.publish`. Programs use an absolute executable and argument array, never a shell. Versioned input contains only nonsecret identity, action and policy version. Invalid output, failure, a two-second timeout, more than 32 KiB output or the eight-process concurrency limit denies the operation. Stable reason codes are logged; raw script output is not. Desktop and Cloud can inspect status and request reevaluation but cannot install scripts or change their paths. Reevaluation applies policy changes without per-packet execution or periodic session leases. Cold startup reevaluates stored Cloud grants with the current executable configuration before installing any egress. Hook refresh immediately fences old Cloud grants in memory and notifies egress even if persistence fails; the denial survives in the authoritative state for the next successful write and directory acknowledgment. Cloud directory synchronization first persists that state and never sends a volatile policy revision. A changed denial becomes durable; unchanged results do not replay committed commands. Desktop member management and `redeven-gateway members reevaluate --member ID --version N` check the current member version before applying the same reevaluation.

## Own-process management

The separate Gateway archive and state root contain no Runtime lifecycle data. Desktop supports URL, local host, SSH host, local container and SSH container registrations. Host registrations expose explicit Gateway Start, Stop, Restart and Update through the existing lifecycle owner. Saving, refresh, pairing or member management never starts a stopped service implicitly.

Host administration and URL client access are separate, request-verified paths. See [Gateway client access](gateway-client-access.md) for host proof, enrollment, revocation and trust migration.

Gateway updates prepare the complete package before stopping the existing service or replacing its Desktop bridge. A package preparation failure leaves both intact. Restart reuses a matching package; a stale package follows the same prepare-before-stop path. Source-built Gateway archives compile the standalone Gateway command without building Runtime frontend assets. Successful replacement retains the state root, Gateway identity, members and client access grants. Preparation diagnostics retain a bounded redacted log head and tail so the compiler cause remains inspectable.

Managed startup waits for the child process's actual exit and reaps failed children. A rejected state file reports its basename, stable reason code and recovery guidance immediately; process existence alone cannot establish readiness. Status retains the startup diagnostic until the implicated file changes or a new service starts. Unsupported schema and retired configuration fail read-only before identity initialization. There is no old-state reader, automatic conversion or automatic reset.

A failed local Gateway does not prevent `dev_desktop.sh` from opening Desktop or preparing other Gateways. Desktop shows host maintenance, blocks ineffective restart/update/pair actions, and offers Refresh, settings, Disable and Remove. Operators repair file access or stop the Gateway and recreate its local configuration, preserve the machine identity, then enroll members again. Disabling a Desktop connection preserves Cloud authorization and other Gateways. Cancellation still stops development startup and exact owned-process cleanup remains required.

## Address changes and upgrade

[Gateway network settings](gateway-network-settings.md) owns atomic network configuration, next-start listener changes, request Host admission and its persistent migration boundary.

Gateway listener bindings describe sockets on the device. Reachable connection endpoints describe the addresses a Runtime can use, including DNS names and port-forwarded addresses that differ from those sockets. Administrators explicitly publish up to sixteen addresses; the Gateway keeps any transport classification and failover ordering as internal metadata. Local interfaces are not automatically published, and deleted endpoints do not return after restart. With no confirmed endpoints, invitation creation is disabled.

The signed code delivery contains the Gateway name, stable identity, selected share address and the complete administrator-confirmed address set. Runtime keeps the most recently connected endpoint first, then administrator priority; a failed session tries another approved endpoint. If all fail, the membership stays intact and reports Gateway unavailable. Endpoint usage is recorded only after a Runtime session succeeds. A listening socket or configured public address does not prove remote reachability. No Cloud origin or listener binding is embedded in the delivery.

The host can update its listener and administrator-confirmed Runtime connection endpoints while retaining the Gateway identity and member CA. Runtime `update-endpoints` verifies a fresh invitation from the same pinned key and CA, using only its signed endpoint descriptor. It retains the existing member and Cloud association; a new identity requires `replace`. Confirmation persists one pending redemption, and the reconnect controller alone delivers it. Repeated confirmation recovers that consent after response loss, including after delivery, while changed or leaving membership invalidates recovery. Desktop registration edits prove the pinned machine key with a fresh signed nonce before saving the new audience.

Runtime configuration version 1 contains one independent Cloud association and one selected route. Gateway local protocol v6 and Cloud management v3 are the only executable contracts. Unsupported configuration and retired fields fail read-only with instructions to create a fresh state root and enroll again. No automatic configuration conversion, implicit Gateway selection or environment migration runs at startup. An ordinary route change preserves environment identity, ownership and binding generation; it requires preflight and explicit confirmation through Runtime's route coordinator.

Transport continues to use the published Flowersec implementation. The fixed WSS enrollment route uses the restricted invitation-code exchange and enrollment TLS profile; ordinary member connections retain CA and pin checks. Administrators do not apply for a public certificate or configure system trust. Runtime users enter an address and code, verify, and approve Gateway access. Optional Cloud publishing remains a separate flow.

# Boundaries

Gateway owns membership, policy, invitations, and restricted forwarding. Runtime remains the owner of its lifecycle, application authentication, and business sessions; Cloud remains the owner of Namespace approval and publication identity. Gateway never dials arbitrary Runtime addresses or turns observations into authority.

# Evidence

- `redeven:internal/config/cloud_config_version_test.go` - Unsupported configuration fails without rewriting operator state.
- `redeven:internal/agent/cloud_route_test.go` - Route changes preserve Cloud association and fence stale owners.

- `redeven:internal/gatewaymembership/store.go` — Sole durable membership and invitation delivery.
- `redeven:internal/gatewaymembership/hooks.go` — Bounded deny-only hook execution.
- `redeven:internal/gatewaymembership/address_test.go` — Address change preserves identity and rejects replacement keys.
- `redeven:internal/gatewaymembership/network_acceptance_test.go` — Real socket failover and endpoint removal with stable membership.
- `redeven:internal/gatewayservice/server.go` — Request-bound host administration and URL access boundary.
- `redeven:cmd/redeven/gateway_membership.go` — Shared live/stopped membership commands and explicit Cloud publication.
- `redeven:internal/localui/gateway_multiple_connections_test.go` — Two real TLS Gateways, independent reconnect and targeted removal.
- `redeven:internal/config/gateway_connections_test.go` — Independent member updates preserve Cloud association and selected route.
- `redeven:desktop/src/main/gatewayLifecycleManager.ts` — Independent Gateway process owner.
- `redeven:cmd/redeven-gateway/main_test.go` — Immediate startup exit, bounded timeout and repaired-state diagnostic invalidation.
- `redeven:desktop/src/main/gatewayServiceHost.test.ts` — Structured command failures, readiness and repair recovery across a real host executor.
- `redeven:scripts/dev_desktop_gateways.test.mjs` — Independent Gateway preparation, cancellation and retained cleanup inventory.
- `redeven:desktop/scripts/check-gateway-local-update.mjs` — Real local update/restart, stable identity and failed-package service/bridge preservation.

## Operational observations

Structured `Gateway operation` log events expose `member.join`, `access.open`,
`cloud.sync`, and Runtime recovery outcomes and `duration_ms`. Aggregate the outcome
counts for admission and recovery success rates and duration distributions for
reverse-stream opening and directory synchronization. These durations cover the
named operation and do not measure complete application rendering. Error text and proof material
are excluded.

Every 30 seconds, `Gateway forwarding` reports the shared LAN/Cloud active budget,
including pending opens and uncompleted cancellation, cumulative admission counts,
and Cloud buffer budgets and completed byte counts. `Gateway Cloud projection`
reports directory age and pending local management commands with its
observation timestamp. During an outage that timestamp stays stale; the backlog
must not be interpreted as a fresh zero. Counters reset when the Gateway restarts.

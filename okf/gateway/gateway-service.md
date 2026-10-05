---
type: Gateway Contract
title: Gateway service
description: Standalone optional Gateway identity, catalog, session, and access forwarding service.
tags: [gateway, desktop, release, access]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

`redeven-gateway` is an optional standalone access forwarder. It owns Gateway identity, pairing, trust, Environment profiles, catalog responses, open-session artifacts, and request forwarding. It never owns, starts, stops, updates, reinstalls, or observes Runtime lifecycle state. Gateway failure can interrupt access through that Gateway, but it cannot block Desktop from managing a Runtime through an authorized Local, SSH, or container channel.

# Contract

## Standalone service

The Gateway CLI starts only the Gateway server. Its `service-start`, `service-status`, and `service-stop` commands manage the Gateway process and state root; they accept no Runtime root, Runtime artifact, activation, binding, or enrollment input. Gateway startup does not create, inspect, or start a Runtime.

The service persists only access-plane state: Gateway identity, paired clients, trust bindings, Environment profiles, catalog metadata, and session material. Runtime operations, target locks, checkpoints, quarantine, artifact staging, rollback, supervisor heartbeat, and Provider management transport are not Gateway state.

Gateway access remains useful without Desktop lifecycle management. An explicit Gateway profile can publish a catalog and issue an open-session artifact for a configured access endpoint. HTTP, WebSocket, and streaming traffic is forwarded according to that access contract; the Gateway does not translate access requests into process commands.

[Gateway access sessions](gateway-access-sessions.md) owns Direct URL versus
Gateway proxy selection, the fixed listening endpoint, session expiry and
revocation, Runtime login isolation, target policy, and configuration migration.
Catalog availability never claims Runtime health. Profile writes require both
the service flag and independent paired-client permission on either transport.

## Packaging

Gateway is built and published as the independent `redeven-gateway_<os>_<arch>.tar.gz` archive. The Desktop Runtime bundle and Runtime archive must not contain `redeven-gateway`, and normal Local, SSH, or container Runtime installation must not create a Gateway managed directory. Desktop may install or update a standalone Gateway only through an explicit Gateway workflow, with its binary stored under the Gateway state root rather than a Runtime root.

The archive and Desktop must use Gateway protocol v3 together. An older Gateway
returns a clear protocol-mismatch diagnosis; Desktop does not probe retired v2
routes. Installing a v3 Gateway automatically migrates supported local profile
state before serving requests; it does not reset trust or require deleting files.

## Retired state

Removing Runtime lifecycle authority must not delete pairing, trust, profiles, catalog configuration, or access sessions. Retired lifecycle stores and staging directories have no production reader and are not consulted before serving access or before a Desktop direct Runtime operation. Cleanup is limited to known Gateway-owned lifecycle artifacts and never reaches a Runtime root or user workspace.

# Boundaries

Desktop owns Runtime lifecycle only for targets with an authorized direct management channel. Provider owns discovery and access authorization. Runtime owns business execution. Gateway owns only its process and the access plane described above. A Gateway-only Environment is access-only and exposes no Runtime lifecycle action.

## Desktop management of the Gateway process

An explicit Gateway registration may use URL, local host, SSH host, local
container, or SSH container transport. URL registrations expose access and
catalog actions only. Desktop manages the other registrations through their
configured host channel and `GatewayLifecycleManager`, with an independent
Gateway binary and state directory. Gateway cards offer Start, Stop, Restart,
and Update according to the observed Gateway service capability. These actions
never invoke Runtime lifecycle management or grant management of catalog targets.

Saving a registration does not install or start a process. Start is explicit;
an absent Gateway package is a first-install Start state, not an Update state.
Setup submits an empty release-source value for the default public release
channel; the display label is never a URL or a protocol value. All five setup
transports must pass the production IPC normalizer before host execution.
background refresh and profile Save/Delete require an already ready Gateway.
Profile authorization, catalog lookup, mutation, and post-write refresh cannot
install, start, or update its service. A stopped service leaves the draft or
delete confirmation open with an explicit Start Gateway action. Starting does
not replay the write: the user reviews and retries Save/Delete, with fresh
profile-write authorization. A service that needs an update directs the user to
the existing Gateway service controls. Stop, Restart, and Update
use the existing confirmation/progress/cancellation surface and explain proxy
session interruption; independently opened Direct URL sessions remain live.
URL pairing requests a pairing code. Managed pairing uses the authenticated
Gateway bridge. Both grant profile write only after separate explicit consent;
transport selection does not imply that permission. Managed package installation
uses Desktop upload of the independent Gateway archive, not Runtime bootstrap.

Profile-write consent is available during both creation and editing. URL consent
requires a pairing code; an unchecked grant does not revoke existing trust.
When managed setup persists a registration but cannot grant permission until
Start, it retains that registration ID and the current form. Explicit Start
returns to Save without replaying consent. Canceled dialog openings ignore late
save/start results. A failed snapshot refresh cannot erase the original failure
or change a successful save into a failed write. Command diagnostics remain
structured, sanitized and available alongside localized guidance.

## Desktop directory and operation presentation

Each Gateway card uses a dedicated route-through-entry mark and one compact
identity row. Connection type and endpoint appear once; service status and trust
share a separate line. One header menu owns settings, deletion and secondary
actions. The environment directory is an inline entry, not a nested panel;
its help control expands registration and reachability guidance without changing
permission. The directory contains explicitly registered targets;
Gateway does not scan the network or discover Runtime installations. An unknown
directory count is distinct from a successfully synchronized empty directory.
Catalog entries do not assert target reachability or Runtime health.

Add environment opens the existing URL-profile form with this Gateway selected
and Gateway proxy as the default access method. View environments opens the
Gateway's directory in the environment list; opening a target verifies access
through the explicitly selected method. Neither action grants Runtime lifecycle
authority. A paired client without profile-write permission receives an
Authorize changes entry into Gateway setup instead of an implicit grant.

The profile-write checkbox has a keyboard-accessible question button. Its
click-expanded body explains names, Runtime URLs, default access methods, and
visibility to other paired Desktops after refresh. It also explains that Runtime
password, MFA, settings, and lifecycle permissions remain independent. Reading
this help never changes consent or submits a request.

Gateway actions use the existing launcher operation as the single progress
owner. Managed service events project into its step timeline, retaining the
active phase and elapsed time on failure. Because installation and host phases
can be skipped or revisited, service progress shows observed steps without an
invented percentage or fixed step total. The shared meter stays visible: it
animates indeterminately during service work, fills on success, and stops on
failure or cancellation. Total elapsed time comes from the operation's main-process
start timestamp, survives stage changes and popover reopening, and freezes at the
terminal snapshot timestamp. The separate current-stage timer remains a waiting
hint. Primary-button labels identify the actual start, stop, restart, or update
operation, including its failure. A single click submits an action once;
the busy primary button uses the shared progress shimmer and reopens that same
operation. Its action icon and admission spinner share the published Button icon
slot, so pending requests never display both. Dismissing the popover does not
cancel or resubmit work. Popovers and
menus retain a noninteractive exit frame, restore trigger focus on Escape, and
respect reduced-motion preferences.

# Evidence

- `redeven:cmd/redeven-gateway/main.go:1` - Standalone Gateway CLI and Gateway-only service commands.
- `redeven:internal/gatewayservice/server.go:1` - Pairing, catalog, profile, open-session, and access forwarding routes.
- `redeven:internal/gatewayservice/server_test.go:1` - Verifies Runtime lifecycle routes and state are absent.
- `redeven:spec/openapi/gateway-v3.yaml:1` - Access-only Gateway HTTP contract.
- `redeven:desktop/src/welcome/GatewaySetup.client.test.tsx` - Explicit managed registration, URL pairing input, and own-service start interactions.
- `redeven:desktop/src/main/gatewayLifecycleManager.test.ts` - Gateway-only service operations, target isolation, and URL management rejection.
- `redeven:desktop/src/main/gatewayServiceProgress.test.ts` - Observed service phases, repeated-phase timing, and terminal progress.
- `redeven:desktop/scripts/check-gateway-card-experience.mjs` - Real browser card actions, delayed progress, motion, focus restoration, and consent explanation.
- `redeven:desktop/src/main/gatewayServiceHost.ts:1` - Explicit standalone Gateway installation under the Gateway state root.
- `redeven:.github/workflows/release.yml:1` - Independent Gateway archive build and publication.

---
type: Protocol Contract
title: RCPP v4 Cloud API
description: Single Cloud input, authoritative Access Point assignment, native OAuth and access authorization.
tags: [protocol, cloud, openapi, desktop, runtime, access]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

RCPP v4 has one Cloud authority and Cloud-assigned Access Points. Runtime accepts one Cloud origin, resolves a link ticket's assignment, exchanges at that Access Point, persists the exact binding and then connects. Cloud identity uses `cloud_id` and `cloud_origin`; model providers remain a separate AI concept. Cloud grants access, while direct Runtime management retains its existing owner. Old protocols fail explicitly; local saved-state migration preserves identities and credentials without retaining an old network path.

# Contract

## Discovery and access

Cloud exposes `/.well-known/redeven-cloud.json` and fixed `/api/rcpp/v4` authorization and access routes. CLI uses `--cloud` (default `https://redeven.com`) and mutually exclusive `--link-ticket`, `--link-ticket-file` or `--link-ticket-stdin`. Cloud input alone never bootstraps or rebinds. Console setup and Desktop issue the same `runtime_link_ticket` while retaining their setup-ready and permission checks. Runtime calls Cloud `runtime-link/resolve` without consuming the ticket, then exchanges at the returned Access Point using one DTO and durable delivery ID. Clients never infer regional domains, decode tickets for routing or forward credentials across origin redirects. Open-session remains access-only.

Environment list responses publish `protocol_version=rcpp-v4` and describe identity, availability, health, access routes, and the current user's explicit `can_connect`, workspace-read, workspace-write, and workspace-execute capabilities. They do not contain `runtime_management`, lifecycle permissions, permits, target generations, bindings, relay state, supervisor freshness, or operation projections. Health is an access observation and cannot make Provider a lifecycle coordinator.

One v4 Runtime-link path replaces the retired manual bootstrap protocol. Exact replay cannot advance a generation twice. An expired delivery returns `409/RUNTIME_LINK_DELIVERY_EXPIRED`. Control pools use the independent `control_artifact_pool_v2` contract. Portal retires old responses without rewriting ciphertext, digest or AAD; request IDs, sequences and replay fences remain durable. Native login, refresh and revocation use `/api/rcpp/v4/mobile`, with third-party identity named `OAuthProvider` / `oauth_provider`.

## Saved state migration

Runtime atomically migrates `provider_origin`, `controlplane_base_url` and `controlplane_provider_id` to current Cloud fields and pool schema 1 to 2. Artifact bytes, spend state, pending maintenance and generation remain intact. A pending pre-v4 delivery retains local identity but receives a new v4 request ID. Desktop migrates account and environment catalogs transactionally, preserves identity keys, file paths and encoded refresh tokens, and rolls back failed writes. Conflicting fields and unknown versions fail without modifying source data. No migration changes authorization, selected environment or Runtime binding. Runtime Service epoch 45 retains the upgrade window for epochs 9 through 44 and the Runtime-owned model directory contract.

## Authorization boundary

Provider authenticates the user and grants access to an Environment or Runtime link. It never receives Desktop SSH credentials, container credentials, a Runtime installation root, or a Runtime package. It cannot turn a Gateway access endpoint into a management channel.

Desktop may show Provider Connect or Disconnect for a directly managed Runtime target. That action links access identity only. All Runtime lifecycle actions continue through the target's Local, SSH, or container channel and remain available independently of Provider health.

The retired Runtime management routes, permits, enrollment challenge/exchange, supervisor heartbeat, poll/respond transport, bindings, relays, cluster state, and authorization audit have no supported schema or compatibility shell. Because those contracts were not deployed, their migrations are removed rather than retained as dead production paths.

## Desktop account sign-out

Redeven Cloud is the official control plane, not a removable service. Desktop exposes Sign out for its saved account. The internal `sign_out_control_plane` request names the exact Provider origin and ID and returns `signed_out_control_plane`; the former delete action is not an alias. Sign-out marks the account's Launcher subject deleted so stale asynchronous work cannot restore it, commits removal of the saved account, refresh token and cached Provider Environments, and clears transient access, sync and pending authorization state. The committed snapshot is visible before background cleanup attempts authorization revocation and closes the captured Cloud sessions. Network failure does not delay clearing local sign-in state or restore the account.

Sign-out does not delete the user's Cloud account or environments, remove Runtime registrations, disconnect Runtime-side links, or sign out the system browser. Its confirmation states the Desktop-local scope and best-effort revocation. A new explicit browser sign-in restores Cloud browsing. Missing saved identity is a typed failure. Environment registration ownership remains with [Desktop registrations](../desktop/desktop-environment-registrations.md).

## Desktop product and origin boundary

Released Desktop builds accept only the canonical production Redeven Cloud HTTPS origin defined by the shared origin policy. Development builds may additionally accept `https://redeven.test`; no build accepts an arbitrary custom control-plane URL. The main process projects its allowed origins and each Runtime binding's origin-support decision into the Welcome snapshot. The Renderer offers only that projected list and does not infer policy from `process.env`, `import.meta.env`, or a second origin implementation. The main process repeats the same check before starting browser authorization and before saving an authorization result, so Launcher IPC and deep links cannot widen the product boundary.

On upgrade, Desktop removes unsupported control-plane accounts, refresh tokens, cached Provider Environments, and matching Desktop-local binding snapshots before Environment synchronization or window restoration. This migration is idempotent and must persist successfully before normal startup continues. It does not revoke remote authorization, close sessions, or disconnect a Runtime-side link.

If a Runtime later reports an unsupported legacy control-plane link, Desktop identifies it as an unsupported legacy link rather than Redeven Cloud. Redeven Cloud open, refresh, and new-link actions stay unavailable; direct Runtime lifecycle actions remain independent, and the only control-plane recovery action is a user-initiated disconnect of that legacy link.

## Saved connection recovery

A saved Provider association is intent, not proof of connectivity. Runtime Service exposes `cloud_link.connection_state`: `connected` requires successful control registration; `connecting` and `retrying` retain Flowersec ownership; `authorization_required` distinguishes exhausted credentials from revoked or rejected access. `disabled`, `error`, and `unknown` never count as online. An empty standby reserve does not invalidate a registered session or an in-flight connection attempt. Terminal registration and heartbeat failures retire the unusable session. CLI startup emits actionable recovery guidance while Local UI remains available.

Desktop observes only already attached, running Runtime management endpoints, even when Welcome is closed. Only `CONTROL_CREDENTIALS_EXPIRED` and `CONTROL_CREDENTIALS_EXHAUSTED` permit automatic credential renewal with a saved account authorization. It never starts a Runtime, opens an SSH bridge, changes a device association, or extends/reuses a spent artifact. Missing authorization directs users to account sign-in. Other terminal failures require explicit review. Runtime cards report the actual Cloud state separately from local availability and offer restoration of the selected saved connection without unlinking or restarting local work.

The Runtime-control connect request sets `renew_current_binding` with the complete `expected_current_binding`. Runtime exchanges a fresh RCPP ticket with `expected_binding_generation`; Portal atomically renews only the same user, local identity, Environment and generation, and returns generation plus one. Missing, revoked or replaced associations fail with `RUNTIME_LINK_BINDING_STALE`. Exact delivery replay handles a lost HTTP response without issuing a second generation. If the metaserver advances but Region cannot commit delivery, automatic recovery stops on the stale generation and requires explicit review; it never guesses a replacement generation.

Desktop coalesces wake events per target and allows at most three authorization exchanges per transient-failure round, waiting at least 30 seconds then two minutes after completion. After the round, it probes the saved access point through read-only health queries every minute; a successful probe permits a new bounded round. Resume advances only recoverable waits. Electron Chromium connection refusals, temporary network loss, and Runtime exchange connection refusals remain transient; certificate and protocol failures require review. Background recovery continues when Welcome is closed and requires remote access to remain enabled.

Successful issuance must lead to observed control registration before another automatic generation can be issued. Token refresh alone does not reset the retry budget. Account changes, sign-out, explicit disconnect and target replacement fence late completions. Explicit connection actions wait for an already-sent automatic exchange to finish and re-read the binding before acting. Transport reconnect remains solely owned by Flowersec. Portal support for the renewal field must be deployed before Desktop/Runtime epoch 31; old strict RCPP handlers reject the new request and cannot silently perform an unrestricted link.

Expired account authorization requires sign-in; revoked permission requires access review without a sign-in loop. A replaced binding requires connection review. These terminal outcomes remain visible until explicit user intent or account authorization changes. Background status reads are fenced across manual connection actions, so a late read cannot restore an obsolete connection snapshot.

# Boundaries

RCPP v4 does not mirror Desktop Launcher Operations or Gateway state. Cloud may route requests to Runtime directly or through an optional Gateway, but it cannot start or repair the destination. An Environment with Cloud or Gateway access but no direct Desktop management channel remains access-only.

# Evidence

- `redeven:desktop/src/main/cloudClient.ts:1` - Desktop Provider discovery, health, open-session, and Runtime-link adapter.
- `redeven:desktop/src/shared/cloud.ts:1` - Access-only Provider DTOs exposed to Desktop.
- `redeven:desktop/src/main/cloudCredentialRecovery.ts` - Bounded credential exchange, service probing, diagnostics and explicit-intent serialization.
- `redeven:desktop/scripts/check-cloud-recovery.mjs` - Real Electron connection refusal and late-service recovery without duplicate issuance.
- `redeven:desktop/src/main/desktopWelcomeState.ts:737` - Projects main-process origin policy into Runtime-link targets and Welcome state.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Separates Provider cards from direct Runtime operation targets.
- `redeven:desktop/src/shared/redevenCloud.ts:1` - Authoritative released and development Redeven Cloud origin policy.
- `redeven:desktop/src/main/desktopPreferences.ts:1808` - Idempotent Desktop-local cleanup of unsupported saved control-plane state.
- `redeven:desktop/src/main/main.ts:4003` - Startup persistence and authorization-boundary enforcement.
- `redeven:desktop/src/welcome/viewModel.ts:646` - Unsupported legacy Runtime-link presentation and manual recovery boundary.
- `spec/openapi/rcpp-v4.yaml:1` - Machine-readable v4 Cloud, mobile OAuth and unified Runtime-link contract.
- `spec/openapi/gateway-v5.yaml:1` - Gateway access-only protocol surface.

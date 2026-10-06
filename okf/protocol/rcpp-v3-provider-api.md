---
type: Protocol Contract
title: RCPP v3 provider API
description: Provider discovery, health, open-session, Runtime link, and access authorization contract.
tags: [protocol, provider, openapi, desktop, runtime, access]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

RCPP v3 lets Desktop discover Provider Environments, read access health, open an authorized session, and link a Runtime for Provider access. `Provider` is the protocol and engineering term; the supported Desktop product surface presents this control plane as `Redeven Cloud`. Provider is not a Runtime lifecycle owner: its Environment response carries no Runtime management capability, and it issues no Start, Stop, Restart, Update, Reinstall, enrollment, supervisor, or artifact authority. A removed lifecycle request fails as unsupported or not found without a compatibility fallback.

# Contract

## Discovery and access

Provider exposes the fixed `rcpp-v3` discovery, Desktop authorization, Environment list, health, Desktop open-session, and Runtime-link authorization/exchange routes. Open-session is access-only and never carries either a process-management instruction or a `bootstrap_ticket`. Runtime link is a separate two-step flow: a Provider access token with namespace admin permission obtains a short-lived, independently typed ticket, then Runtime exchanges that ticket on the same access point using an exact request and a durable idempotency ID.

Environment list responses publish `protocol_version=rcpp-v3` and describe identity, availability, health, access routes, and the current user's explicit `can_connect`, workspace-read, workspace-write, and workspace-execute capabilities. They do not contain `runtime_management`, lifecycle permissions, permits, target generations, bindings, relay state, supervisor freshness, or operation projections. Health is an access observation and cannot make Provider a lifecycle coordinator.

Runtime-link delivery is independent from the frozen v2 manual-install bootstrap endpoint. Its ticket type, request/response DTOs, outbox `delivery_kind`, exact replay bytes, error codes, and encryption AAD are distinct. An expired delivery returns `409/RUNTIME_LINK_DELIVERY_EXPIRED`; a manual bootstrap delivery can never be replayed as an RCPP v3 response. The v2 mobile-auth namespace is likewise independent and does not make v2 Desktop or Provider-access routes valid.

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

A saved Provider association is intent, not proof of connectivity. Runtime Service exposes `provider_link.connection_state`: `connected` requires successful control registration; `connecting` and `retrying` retain Flowersec ownership; `authorization_required` distinguishes exhausted credentials from revoked or rejected access. `disabled`, `error`, and `unknown` never count as online. An empty standby reserve does not invalidate a registered session or an in-flight connection attempt. Terminal registration and heartbeat failures retire the unusable session. CLI startup emits actionable recovery guidance while Local UI remains available.

Desktop observes only already attached, running Runtime management endpoints, even when Welcome is closed. Only `CONTROL_CREDENTIALS_EXPIRED` and `CONTROL_CREDENTIALS_EXHAUSTED` permit automatic credential renewal with a saved account authorization. It never starts a Runtime, opens an SSH bridge, changes a device association, or extends/reuses a spent artifact. Missing authorization directs users to account sign-in. Other terminal failures require explicit review. Runtime cards report the actual Cloud state separately from local availability and offer restoration of the selected saved connection without unlinking or restarting local work.

The Runtime-control connect request sets `renew_current_binding` with the complete `expected_current_binding`. Runtime exchanges a fresh RCPP ticket with `expected_binding_generation`; Portal atomically renews only the same user, local identity, Environment and generation, and returns generation plus one. Missing, revoked or replaced associations fail with `RUNTIME_LINK_BINDING_STALE`. Exact delivery replay handles a lost HTTP response without issuing a second generation. If the metaserver advances but Region cannot commit delivery, automatic recovery stops on the stale generation and requires explicit review; it never guesses a replacement generation.

Desktop coalesces wake events per target and allows at most three authorization exchanges per transient-failure round, waiting at least 30 seconds then two minutes after completion. After the round, it probes the saved access point through read-only health queries every minute; a successful probe permits a new bounded round. Resume advances only recoverable waits. Electron Chromium connection refusals, temporary network loss, and Runtime exchange connection refusals remain transient; certificate and protocol failures require review. Background recovery continues when Welcome is closed and requires remote access to remain enabled.

Successful issuance must lead to observed control registration before another automatic generation can be issued. Token refresh alone does not reset the retry budget. Account changes, sign-out, explicit disconnect and target replacement fence late completions. Explicit connection actions wait for an already-sent automatic exchange to finish and re-read the binding before acting. Transport reconnect remains solely owned by Flowersec. Portal support for the renewal field must be deployed before Desktop/Runtime epoch 31; old strict RCPP handlers reject the new request and cannot silently perform an unrestricted link.

Expired account authorization requires sign-in; revoked permission requires access review without a sign-in loop. A replaced binding requires connection review. These terminal outcomes remain visible until explicit user intent or account authorization changes. Background status reads are fenced across manual connection actions, so a late read cannot restore an obsolete connection snapshot.

# Boundaries

RCPP v3 does not mirror Desktop Launcher Operations or Gateway state. Provider may route requests to Runtime directly or through an optional Gateway, but it cannot start or repair the destination. An Environment with Provider or Gateway access but no direct Desktop management channel remains access-only.

# Evidence

- `redeven:desktop/src/main/controlPlaneProviderClient.ts:1` - Desktop Provider discovery, health, open-session, and Runtime-link adapter.
- `redeven:desktop/src/shared/controlPlaneProvider.ts:1` - Access-only Provider DTOs exposed to Desktop.
- `redeven:desktop/src/main/providerCredentialRecovery.ts` - Bounded credential exchange, service probing, diagnostics and explicit-intent serialization.
- `redeven:desktop/scripts/check-cloud-recovery.mjs` - Real Electron connection refusal and late-service recovery without duplicate issuance.
- `redeven:desktop/src/main/desktopWelcomeState.ts:737` - Projects main-process origin policy into Runtime-link targets and Welcome state.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Separates Provider cards from direct Runtime operation targets.
- `redeven:desktop/src/shared/redevenCloud.ts:1` - Authoritative released and development Redeven Cloud origin policy.
- `redeven:desktop/src/main/desktopPreferences.ts:1808` - Idempotent Desktop-local cleanup of unsupported saved control-plane state.
- `redeven:desktop/src/main/main.ts:4003` - Startup persistence and authorization-boundary enforcement.
- `redeven:desktop/src/welcome/viewModel.ts:646` - Unsupported legacy Runtime-link presentation and manual recovery boundary.
- `spec/openapi/rcpp-v3.yaml:1` - Machine-readable RCPP v3 and isolated manual-bootstrap contract.
- `spec/openapi/gateway-v4.yaml:1` - Gateway access-only protocol surface.

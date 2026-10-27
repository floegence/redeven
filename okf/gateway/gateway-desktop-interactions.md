---
type: Interaction Contract
title: Gateway Desktop interactions
description: Gateway enrollment, connection ownership and consent.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
quality_exception: Cross-boundary consent contract spanning enrollment, welcome task ownership, and management presentation; each surface keeps its own authority check inside one Desktop interaction.
---
# Summary

Desktop enrolls managed Local, SSH, WSL and container targets. Runtime management, invitation verification and local consent are separate authority checks. Members appear only after joining; no Runtime URL form exists. Observations preserve steps and drafts; confirmed faults require explicit recovery.

# Contract

## Enrollment owner

Creation offers Not now or After setup, add Gateway access before inspection/startup. Connect before verification/consent; an earlier Env App open proves no live connection. Creation and cards share one app-owned enrollment session, never separate dialogs/auth/recovery owners. Settings suspends it; closure restores its initiating control.

Each opening owns a sender/target-bound lease on the exact Env App bridge. Env App closure cannot release it; cancel, renderer navigation/destruction and authority changes do. Reject late requests, but retain admitted-write transport through settlement. Connection may instead try the saved management channel with available SSH/OpenSSH authentication. Passive auth_required or absent saved password cannot preempt that attempt. Only current authentication failure exposes the focused inline Enter-submittable password and stops credential-free retries. Distinguish auth, Gateway and container-engine failures.

Only scoped enrollment status accepts a temporary password; verification/consent never do. It overrides connection credentials without saving preferences; clear renderer secrets after connection/failure/closure. Reopening gets a fresh scope and authentication attempt. Proven stopped Runtime/container shows explicit Start. Start/restart/update use the existing lifecycle owner/dispatch, try available auth first, and request temporary credentials only for typed SSH failure. Carry credentials unchanged through execution/access verification; never persist, clear after settlement. Startup observations cannot interrupt their owning action or race clearing. Recovery revokes consent before reconnecting. Opening/connecting never implicitly starts Runtime.

Connection loss stops submission/polling; explicit recovery retains drafts. Loss/authority change requires fresh verification. Observations cannot cancel pending actions. Settings suspends the connection and invalidates verification, retaining step/code drafts; return reconnects before submission. Internal checks use inline feedback, not refreshed toasts. Unknown status never means rejected credentials; details retain the diagnosis.

## Gateway choice and invitations

Saved/manual tabs retain independent drafts/input nodes. Selection keys an enabled saved registration ID across URL, local/SSH and container kinds, never address/connectivity. Keep endpoint-less registrations with inline setup. Prefer confirmed member_endpoints; URL registrations may use canonical HTTPS origin if catalog endpoints are absent. Never derive endpoints from SSH/listener coordinates. Reject revoked/changed trust, invalid or Host-rejected origins and remote loopback without hiding eligible registrations. Late inventory preserves typing/focus; removal of a selected usable address revokes verification.

For managed Gateways with manage_members, the same owner saves addresses via update_gateway_endpoints, preserving endpoints/listeners/Host restrictions. Hold authoritative IPC endpoints only until catalog change; never resurrect removals. Explicit invite_gateway_runtime or pasted codes are required; saving/selection/issuance does not enroll. URL/access-only users get administrator address/code guidance. Authority changes, closure and suspension reject late responses while observations retain pending actions. Runtime verification/explicit consent are mandatory. Success consumes code; reopening clears code/consent.

Accepted enrollment shows a result; membership differs from connectivity. Unknown submission queries exact Gateway membership and never resubmits its invitation. Positive status completes; authoritative absence clears consumed/uncertain material and returns to verification. Ordinary checks consume no invitation. Done returns to origin.

## Welcome and task continuity

Retain toolbar, horizontal Environment/Redeven Cloud/Gateway navigation, search/filter and bottom bar. Cards use a responsive grid, compact wide columns and one narrow column. Name/Manage opens an in-shell page: Overview, Clients, Runtimes, Network, Redeven Cloud, Service maintenance; no separate Desktop connection section. Title-row back arrow has localized All Gateways name/tooltip and restores query/position/focus. Reopen retains drafts; global navigation suspends existing task/page owners.

Card header groups identity/management; equal-width full-row Connect client/Runtime actions stay together in narrow locales. Footer holds observed status with refresh/recovery. Manage/More share Floe small-control height/centerline and expand touch targets together. Access-only cards omit enrollment. Align overview values and member names/status. Shared Dropdown contains local Edit, Enable/Disable and Remove only; bounded edit Dialog and removal confirmation explain local-only scope (no remote revocation/service stop). Clients/Cloud initialize independently. URL connections never inherit stale administration. One mounted action owner survives filtering; no hidden maintenance card.

Creation first chooses existing service or new deployment, with distinct URL-pairing/host-container transport. Save returns exact registration ID and opens its overview/status/next action; saving establishes neither deployment nor connectivity. Start stays explicit.

Connect Runtime distinguishes Desktop-managed versus another administrator. Managed choice and Environment Add Gateway access share the app enrollment session with corresponding object preselected. Other-admin choice opens the existing invitation issuer in a bounded task dialog; missing addresses link to the network editor. Picker includes stopped/unopened environments. No nested member enrollment or second issuer. Wait for outgoing modal presence before transition, preserving draft/return context. Hiding retains draft/admitted work; existing card actions resume it, without a global banner. Resume reacquires management and revokes old consent, never reuses released leases.

## Management presentation

Use quiet Floe content, compact sidebar, wrapped navigation below 768 px. Only active sections affect Welcome scroll extent; visited sections remain mounted for drafts/codes/progress. Enrollment/edit/service tasks use published Dialogs over the page, without competing nested overlays. Keyboard dismissal/transitions restore origin. Ready empty cards show count without a banner. Semantic tokens, shared controls and explicit catalogs follow floe-webapp.

Readiness uses observed service and verified protocol, not Desktop build equality. Refresh/pairing/invitations reuse compatible installed Gateways. Repair never invents start-required; pairing rejection cannot become update-required from release/commit differences. [Service](gateway-service.md) owns compatibility/integrity.

Runtimes owns membership, per-member Cloud overrides, recheck/removal; global policy belongs to Redeven Cloud. Clients exclusively owns listing/confirmed revocation. Client enrollment prepares editable HTTPS address; only explicit issuance creates a code. Show code/expiry/address with separate/combined copy, retaining draft/code on return. Endpoint observations cannot overwrite addresses. Member/publication/endpoint choices use shared Dropdown. Refresh failure retains lists/invitations; cancellation cannot reopen or discard drafts. Settings/code import grants no Runtime/Namespace authority. [Network settings](gateway-network-settings.md) owns endpoints/listeners/collapsed restrictions and validation/restart.

Panels are viewport-bounded with explicit translations. Shared field-surface Dropdown owns keyboard/focus; focus changes the existing border, not an outer frame. No native select/parallel menu. All catalogs provide HTTPS hostname:port, listener and Host examples; invitation timers use plural rules. Localized member recovery leaves raw/future codes in collapsed details; policy feedback pairs action labels with hook IDs.

Service/card actions share foreground owner, admission and progress. A bounded service Dialog also handles network restart; closing cannot reopen popovers or redispatch. Confirmation shows action/target/affected sessions, no diagnostic inventory, with title-row close. Admission replaces controls with pending until authoritative progress; no duplicate request.

Show observed steps, current state and elapsed time; invent no future stages/percentages. Raw details stay collapsed after timeline; failure keeps concise recovery separately. Stable trigger/close hide the panel and restore focus without stopping work. Reopen retains steps/timing. After reconnect, adopt an existing running operation before offering new confirmation.

# Boundaries

UI state and observations cannot expand authority or imply completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-visual-layout.mjs` — Rendered control geometry, peer sizing, menu focus, multilingual narrow layouts, touch and enlarged text.

- `redeven:desktop/scripts/check-gateway-management-ui.mjs` — Six sections, task dialogs, active-only scroll extent, retained network drafts/client codes, explicit issuance, service confirmation, shared object menus and ten locale catalogs at 390, 430, 768 and 1280 pixels.

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection reuse, authentication failure and consent flows.

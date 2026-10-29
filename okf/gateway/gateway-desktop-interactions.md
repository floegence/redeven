---
type: Interaction Contract
title: Gateway Desktop interactions
tags: [gateway, desktop, interaction, validation]
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Desktop enrolls managed Local, SSH, WSL and container targets through one app-owned session. Runtime management, invitation verification and local consent remain separate authorities. Membership appears only after joining; observations preserve drafts, while confirmed faults require explicit recovery. No Runtime URL enrollment form exists.

# Contract

## Enrollment owner

Creation offers Not now or After setup, add Gateway access before inspection/startup. Creation and cards share connection, dialog, authentication and recovery ownership. Connect before verification/consent: an earlier Env App open proves no current connection. Settings suspends the session; closing restores its initiating control.

Each opening leases the exact sender/target-bound Env App bridge. Env App closure cannot release that lease; cancel, renderer navigation/destruction and authority changes do. Reject late requests while retaining admitted-write transport through settlement. Try the saved management channel with available SSH/OpenSSH credentials; passive auth_required or an absent saved password cannot preempt it. Only a current authentication failure exposes the focused, Enter-submittable password and stops credential-free retries. Distinguish authentication, Gateway and container-engine failures; unknown status is not credential rejection, and details retain diagnosis.

Only scoped enrollment status accepts a temporary password, never verification/consent. Override connection credentials without saving preferences, clearing renderer secrets after connection/failure/closure. Reopening acquires a fresh scope/authentication attempt. Proven stopped Runtime/container offers explicit Start; opening/connecting never starts it implicitly. Start/restart/update use the existing lifecycle owner, try available authentication first and request temporary credentials only for typed SSH failure. Carry credentials unchanged through execution/access verification and clear after settlement. Startup observations cannot interrupt their action or race credential clearing.

Connection loss stops submission/polling but preserves drafts. Explicit recovery, authority change or Settings suspension invalidates verification/consent; reconnect before submitting. Keep step/code drafts; observations cannot cancel actions. Use inline feedback, not repeated toasts.

## Gateway choice and invitations

Saved/manual tabs retain independent drafts and input nodes. Selection keys an enabled registration ID across URL, SSH/local and container kinds, never address/connectivity. Keep endpoint-less entries with inline setup. Prefer confirmed member_endpoints, falling back only to URL registrations' canonical HTTPS origin, never SSH/listener coordinates. Reject changed/revoked trust, invalid/Host-rejected origins and remote loopback without hiding eligible registrations. Late inventory preserves typing/focus; removal of the selected usable address revokes verification.

With manage_members, the same owner saves addresses through update_gateway_endpoints, preserving endpoints/listeners/Host restrictions. Hold authoritative IPC values only until catalog change; never resurrect removals. Enrollment requires explicit invite_gateway_runtime or a pasted code plus Runtime verification/consent. Saving, selecting or issuing does not enroll. URL/access-only users receive administrator address/code guidance. Authority change/closure/suspension rejects late responses; observations preserve pending actions. Success consumes the code; reopening clears code/consent.

Show accepted results separately from connectivity. Unknown submission queries exact Gateway membership without resubmitting the invitation. Positive status completes; authoritative absence clears uncertain/consumed material and returns to verification. Ordinary checks consume no code. Done returns to origin.

## Welcome and task continuity

Retain toolbar, horizontal Environment/Redeven Cloud/Gateway navigation, search/filter and bottom bar. Cards use compact responsive columns and one narrow column. Name/Manage opens an in-shell page with Overview, Clients, Runtimes, Network, Redeven Cloud and Service maintenance; no separate Desktop connection section. Localized All Gateways back control restores query, position and focus. Global navigation suspends existing owners; reopening retains drafts.

Group header identity/management and equal-width full-row Connect client/Runtime actions, including narrow locales. Footer owns observed status and refresh/recovery. Manage/More share Floe small-control height/centerline and expand touch targets together. Access-only cards omit enrollment. Align overview values/member names/status. Shared Dropdown contains local Edit, Enable/Disable and Remove; bounded editing and confirmed removal explain that remote membership/service remain unchanged. Clients/Cloud initialize independently. URL connections inherit no stale administration. One mounted action owner survives filtering; no hidden maintenance card.

Creation distinguishes existing service from new deployment and URL pairing from host/container transport. Saving returns the exact registration ID and opens its overview/status/next action, proving neither deployment nor connectivity. Start remains explicit.

Connect Runtime distinguishes Desktop-managed targets from another administrator. Managed and Environment Add Gateway access share the app session with target preselected, including stopped/unopened targets. Other-admin opens the existing invitation issuer in a bounded dialog; missing addresses link to Network. No nested enrollment/second issuer. Wait for outgoing modal presence before transitions. Hide retains drafts/admitted work, resumed by existing card actions without a global banner. Resume reacquires management and revokes consent; released leases cannot be reused.

## Management presentation

Use compact Floe navigation, wrapping below 768 px. Only active sections affect Welcome scroll extent; visited sections stay mounted for drafts/codes/progress. Published Dialogs own enrollment/edit/service tasks without competing overlays. Keyboard dismissal restores origin. Ready empty cards show counts without banners. Use semantic tokens, shared controls and explicit floe-webapp locale catalogs.

Readiness depends on observed service and verified protocol, not Desktop build equality. Refresh/pairing/invitations reuse compatible installed Gateways. Repair cannot invent start-required or turn pairing rejection into update-required from release/commit differences; [service compatibility](gateway-service.md) is authoritative.

Runtimes owns members, per-member Cloud overrides, recheck/removal; Redeven Cloud owns global policy; Clients owns listing and confirmed revocation. Client enrollment prepares an editable HTTPS address; explicit issuance creates code/expiry/address with separate/combined copy. Return retains drafts/code; endpoint observations cannot overwrite addresses. Shared Dropdowns own member/publication/endpoint choices. Refresh failure preserves lists/invitations; cancellation cannot reopen/discard drafts. Settings/code import grants no Runtime/Namespace authority. [Network](gateway-network-settings.md) owns endpoint/listener/restriction validation and restart.

Viewport-bounded translated panels use shared field-surface Dropdown keyboard/focus behavior; focus changes the border, not an outer frame. No native select/parallel menu. Every catalog supplies HTTPS hostname:port, listener and Host examples plus plural invitation timers. Localized member recovery leaves raw/future codes in collapsed details; policy feedback pairs action labels with hook IDs.

Card/service/network-restart actions share foreground owner, admission and progress. Bounded confirmation shows action, target, affected sessions and title-row close, not diagnostic inventory. Admission replaces controls with pending until authoritative progress; closure cannot reopen popovers/redispatch. Show observed steps, state and elapsed time, never invented stages/percentages. Collapse raw details below timeline; failure retains concise recovery. Trigger/close hides the panel and restores focus without stopping work. Reopen preserves timing/steps; reconnect adopts existing work before new confirmation.

# Boundaries

Presentation never grants authority or proves completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-visual-layout.mjs` — Rendered control geometry, peer sizing, menu focus, multilingual narrow layouts, touch and enlarged text.

- `redeven:desktop/scripts/check-gateway-management-ui.mjs` — Six sections, task dialogs, active-only scroll extent, retained network drafts/client codes, explicit issuance, service confirmation, shared object menus and ten locale catalogs at 390, 430, 768 and 1280 pixels.

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection reuse, authentication failure and consent flows.

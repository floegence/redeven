---
type: Interaction Contract
title: Gateway Desktop interactions
tags: [gateway, desktop, interaction, validation]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Desktop enrolls managed Local, SSH, WSL and container targets through one app-owned session. Runtime management, invitation verification and local consent remain separate authorities. Membership appears only after joining; observations preserve drafts, while confirmed faults require explicit recovery. No Runtime URL enrollment form exists.

# Contract

## Identity and ownership
Desktop IPC, progress, session targets and shared Center presentation use connection_id for the saved connection record; Web Center maps its source_id to that host-local field. gateway_id remains the signed service identity used by Runtime attachment requests and trust records. Neither an address nor a selected Cloud route substitutes for either identity. Ambiguous or retired IPC identity fields fail explicitly. The renderer and main process change together; stored connection IDs, credentials, session keys and schema 5 remain unchanged.

Generic Runtime management uses DesktopRuntimeTargetID and the Runtime placement owner. The single runtime_connection_target projection carries Runtime management facts and derived Cloud connection presentation; Gateway access does not depend on Cloud association, Cloud capability or a Cloud-selected route. Cloud association keeps its own state and mutation coordination; Gateway failures use the attachment error domain. Gateway does not own Runtime lifecycle or Cloud identity.

## Enrollment and authority
One app session serves creation and card actions for managed Local, SSH, WSL and container targets. Creation offers Not now or Add Gateway access after setup. Each opening leases the exact sender/target Env App bridge and connects before verification/consent; prior opening is no current proof. Env App closure retains the lease, while cancel, navigation/destruction and authority changes retire it. Admitted writes retain transport until settlement; reject late requests.

Try saved management authentication first, including available SSH/OpenSSH credentials. Passive auth_required or missing saved passwords cannot preempt it. Only a current typed authentication failure exposes focused, Enter-submittable temporary credentials and stops credential-free retries. Distinguish authentication, Gateway and engine failures; unknown status is not rejection. Temporary passwords belong only to scoped status, never verification/consent; do not save preferences. Carry them unchanged through the admitted action/access verification, then clear on completion/failure/closure. Startup observations cannot race clearing or interrupt the action.

Proven stopped targets offer explicit Start. Start/restart/update/reinstall share the lifecycle owner and request credentials only after typed SSH failure. Connection loss stops submissions/polling but retains drafts. Explicit recovery, authority change or Settings suspension revokes verification/consent; resume with a fresh connection/lease. Preserve step/code drafts and use inline feedback. Observations cannot cancel admitted actions.

## Gateway selection and invitation
Saved/manual tabs keep separate drafts/input nodes. Select enabled registration ID, never address or connectivity. Retain endpoint-less entries with setup guidance. Use confirmed endpoints, otherwise only a URL registration's canonical HTTPS origin; SSH/listener coordinates are not substitutes. Reject changed trust, invalid/Host-rejected origins and remote loopback without hiding registrations. Inventory cannot overwrite typing; removing a selected usable address revokes verification.

Shared-address edits require manage_network and use update_gateway_endpoints without changing listeners/restrictions. Retain authoritative IPC values only until catalog change; never restore removed addresses. Enrollment needs explicit invite_gateway_runtime or pasted code plus Runtime verification/consent. Saving/selecting/issuing alone never enrolls. Access-only users receive administrator guidance. Close/suspension/authority changes fence late responses; success consumes code and reopening clears consent/code.

The owner API always returns an attachments collection, derived counts, runtime_running and observed_at_unix_ms. Each item separates durable attachment_state from connection_state; phase is presentation only. Connected requires a current connected controller, while unknown, connecting, disconnected, failed and stopped remain distinct. Stopped CLI and running Runtime share the same projection. Counts never imply aggregate connectivity. Desktop rejects legacy aggregates and contradictory states under Runtime epoch 71.

A successful submission must include the exact admitted attachment. Missing, unrelated or removing attachments preserve uncertainty instead of closing the flow. Unknown submission queries exact membership without resubmitting. Positive membership completes; authoritative absence clears uncertain/consumed material and returns to verification. Checks consume no code. Done restores the originating control.

Pairing has no Cloud environment choice or existing-environment DTO. Cloud enrollment and route changes remain separate operations. Replacement is supported only for a sole attachment. With multiple Gateways, add and verify the new attachment, explicitly change the Cloud route if needed, then remove the old attachment.

## Welcome and management
Keep toolbar, horizontal Environment/Redeven Cloud/Gateway navigation and bottom bar. List search/filter/description hide in Gateway detail and restore on return. Responsive compact cards become one column when narrow. Name/Manage opens an in-shell page: Overview, Clients, Runtimes, Network and Service maintenance. Localized All Gateways restores search/scroll/focus. Global navigation suspends owners and reopening preserves drafts.

Cards group identity/management, equal full-row Connect client/Runtime actions, and a stable status/refresh footer. Pending, failed and recovered observations never append rows or change card height. Catalog failure takes priority over process readiness; the existing help control opens anchored details without reflow. Compact cards keep the refresh icon and disclose trust in details. Manage/More share Floe control geometry and touch sizing. Access-only cards omit enrollment. Shared Dropdown offers local Edit, Enable/Disable and confirmed Remove, explaining retained remote membership/service. Client trust and local network policy initialize independently; URL access inherits no stale administration. One action owner survives filtering, without a hidden maintenance card.

Creation separates existing service/new deployment and URL pairing/host transport. Save returns the exact registration and opens its overview/status/next action; it proves neither deployment nor connectivity. Connect Runtime distinguishes Desktop-managed targets from another administrator. Managed enrollment reuses the app session, including stopped/unopened targets. Other-admin uses the existing invitation issuer; missing addresses link to Network. Wait for outgoing modal presence. Hiding preserves admitted work/drafts; resume through card actions with fresh management/consent, without another issuer or banner.

Management uses one bounded reading column, icon navigation and one toolbar per section. Selection uses subtle background and weight without edge markers. Overview prioritizes access address and connection actions; identity details stay collapsed. Clients use a count and illustrated empty state. Network aligns labels and values, with explanatory help on demand. Availability feedback has one workspace owner and disappears when access recovers; drafts survive and issued credentials stay invalidated. Only active sections contribute scroll extent; visited sections stay mounted. Below 768 px, section navigation scrolls horizontally with intact labels. Dialogs own edit/enrollment/service tasks and keyboard return. Ready empty cards show counts without banners. Use semantic tokens and explicit locale catalogs. Compatible installed Gateways are reused; build/commit inequality cannot invent start/update requirements or reinterpret pairing rejection. [Service compatibility](gateway-service.md) owns readiness.

Runtimes owns attachments, local egress overrides, explicit egress-policy reevaluation and removal; Network owns destinations and default egress; Clients owns all paired device listings/revocation, labels the current device and offers explicit fresh-key reauthorization after self-revocation. Host management remains usable throughout. Client enrollment prepares editable HTTPS, then explicitly issues code/expiry/address with individual/combined copy. Observations retain addresses/codes/drafts. Shared Dropdowns own choices; refresh failure preserves data. Settings/import grants no Runtime/Namespace authority. [Network](gateway-network-settings.md) owns validation/restart.

Translated panels stay viewport-bounded with shared keyboard/focus behavior and border-only focus. All locales supply hostname:port, listener/Host examples and plural timers. Localized connection recovery keeps raw/future codes in details; policy feedback pairs action labels with hook IDs.

## Service actions
Card/service/network-restart actions share admission, foreground ownership and progress. Confirmation names action/target/affected sessions and title-row close. Pending replaces controls until authoritative progress. Closing cannot reopen or redispatch. Show observed steps/state/elapsed time, never fabricated percentages. Raw details collapse beneath timeline; failure retains recovery. Hide restores focus without canceling; reopen retains timing, and reconnect adopts current work before another confirmation.

Service maintenance uses compact open rows, shared text/control sizes and a distinct operation icon per action. Software and service controls use aligned buttons; impacts appear in confirmation, not permanent explanatory cards. Host upgrade/reinstall remain available for stopped, incompatible, unpaired, revoked or previously unreachable services; each attempt must authenticate the configured host. URL-only registrations gain no host controls. Configuration recovery is a separate confirmed action with explicit attachment/network loss and retained identity/archive disclosure. Failed maintenance keeps the actual operation error and can open a new recovery confirmation without stale progress taking over.

# Boundaries

Presentation never grants authority or proves completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-visual-layout.mjs` — Rendered control geometry, peer sizing, menu focus, multilingual narrow layouts, touch and enlarged text.

- `redeven:desktop/scripts/check-gateway-management-ui.mjs` — Five sections, task dialogs, active-only scroll extent, retained network drafts/client codes, explicit issuance, service confirmation, shared object menus and ten locale catalogs at 390, 430, 768 and 1280 pixels.

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection reuse, authentication failure and consent flows.

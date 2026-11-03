---
type: Interaction Contract
title: Gateway Desktop interactions
tags: [gateway, desktop, interaction, validation]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Desktop enrolls Local, SSH, WSL and container Runtimes through one app session. Management, invitation verification and consent are separate authorities; only confirmed membership completes enrollment. Observations retain drafts, failures require explicit recovery, and no Runtime URL enrollment form exists.

# Contract

## Identity
`connection_id/connectionID` identifies saved registrations across IPC, progress, sessions and Center; Web Center maps `source_id` to it. `gateway_id/gatewayID` identifies signed trust/attachments. DesktopGatewayAttachment and Center environments are projections; DesktopRuntimeTargetID/placement owns lifecycle. Addresses/Cloud routes replace neither ID. Reject ambiguous/retired IPC fields; update main/renderer together, preserving stored IDs, credentials, keys and schema5.

One runtime_connection_target projects management/derived Cloud facts. Gateway access is independent of Cloud association/capability/route; Cloud mutations and attachment errors retain separate coordination/domains.

## Enrollment session
Use a padded, content-sized selector with Dropdown and trailing Cancel; empty inventory offers recovery. Selection opens the fixed-height wizard; wrapped/touch content retains natural height.

Creation offers Not now/Add Gateway access. Each opening leases the exact sender/target bridge and connects before fresh verification/consent. Env App close retains the lease; cancel, navigation, destruction or authority change retires it. Admitted writes retain transport until settlement; reject late submissions.

Try saved management/SSH/OpenSSH credentials first. Passive auth_required/missing credentials cannot preempt; only typed current auth failure reveals focused temporary credentials with Enter and stops credential-free retries. Separate auth/Gateway/engine faults; unknown is not denial. Never save passwords or infer consent. Retain credentials through admitted action/access verification, clearing on completion/failure/close without observation races.

Confirmed stopped offers Start. Start/restart/update/reinstall share lifecycle owner; ask SSH credentials only after typed failure. Loss stops submissions/polls, preserving drafts. Explicit recovery, authority change or Settings suspension revokes verification/consent; resume with fresh lease/connection and step/code drafts. Observation cannot cancel admitted work.

## Invitation and completion
Saved/manual tabs retain independent drafts/nodes. Select enabled registration IDs. Endpoint-less registrations retain guidance; use confirmed endpoints or canonical HTTPS origin, never SSH/listener coordinates. Reject changed trust, Host-rejected origin or remote loopback without hiding registrations. Inventory preserves typing; removed usable addresses revoke verification.

Shared-address editing needs manage_network/update_gateway_endpoints, without listener/restriction changes. IPC address persists only until catalog change. Admission needs explicit invite_gateway_runtime or pasted code plus Runtime verification/consent; save/select/issue alone is insufficient. Access-only shows administrator guidance. Close/suspend/authority change fences replies; success consumes code; reopen clears code/consent.

Owner API always returns attachments/counts/runtime_running/observed_at_unix_ms. attachment_state is durable; connection_state observed; phase is presentation. Connected requires current controller. Unknown/connecting/disconnected/failed/stopped differ. CLI/running Runtime share projection; counts prove no connectivity. Epoch71 rejects legacy aggregates/contradictions.

Success requires exact admitted non-removing attachment; absent/unrelated results stay uncertain. Unknown submissions query exact membership without replay: positive completes, authoritative absence clears uncertain/consumed material and returns verification. Checks consume no code; Done restores origin focus. No Cloud choice/existing-environment DTO. Replacement requires sole attachment; otherwise add/verify new Gateway, explicitly change Cloud route if needed, remove old.

## Welcome/management
Retain toolbar, horizontal Environment/Redeven Cloud/Gateway navigation and bottom bar. Details hide search/filter/description; localized All Gateways restores search/scroll/focus. Narrow cards use one column. Name/Manage opens the five sections in-shell; global navigation suspends owners, preserving drafts.

Cards group identity/management, equal full-row Connect client/Runtime and fixed-height status/refresh. Catalog failure outranks readiness. Anchored help avoids reflow; trust stays in details. Use Floe Manage/More geometry/touch; access-only omits enrollment. Edit/Enable/Disable/confirmed Remove disclose retained service/membership. Initialize trust/local policy separately; URLs grant no administration. Filtering preserves action owners without hidden maintenance cards.

Creation separates service/deployment from URL pairing/host transport. Save opens exact registration status/action without proving connectivity/deployment. Include stopped/unopened managed Runtimes; other-admin uses the existing issuer; missing addresses link Network. Await modal exit. Hide retains drafts/work; reopen renews management/consent via card actions without duplicate issuers/banners.

Use a bounded reading column and icon navigation/toolbar; selection uses fill/weight. Overview prioritizes address/actions and collapses identity. Clients shows counts/illustrated emptiness; narrow identity/time/actions stack. Network aligns labels/values and maintenance edges, with ordinary path/listener fonts and on-demand help. Times retain exact localized tooltips. Match input/action heights/touch targets. Resize help next frame; cancel on disposal. One availability owner clears recovered feedback while retaining drafts/invalidated credentials. Visited panels stay mounted; only active sections affect scroll extent. Below768px, scroll full navigation labels. Dialogs restore focus; empty cards show counts. Use semantic tokens and every explicit locale. Build inequality cannot invent actions or reinterpret rejection; reuse compatible [services](gateway-service.md).

Runtimes owns attachments/egress overrides/reevaluate/remove; Network owns destinations/default egress; Clients owns listing/revoke/current-device/fresh-key reauthorization. Host management survives self-revoke. Client enrollment prepares editable HTTPS, explicitly issues code/expiry/address and separate/combined copy. Observations retain values/drafts. Uncertain mutation retains operation ID/review at origin; refresh cannot clear fence/enable writes. Explicit review clears fence only, no replay. Avoid duplicate heading; Dropdown choices and failed refresh retain data. Settings/import grants no Runtime/Namespace authority. [Network settings](gateway-network-settings.md) owns validation/restart.

Panels remain viewport-bounded with keyboard return/border-only input focus. All locales supply hostname:port, listener/Host examples/plural timers. Raw/future recovery codes stay in details; policy feedback pairs action labels/hook IDs.

## Service actions
Card/service/network restart share admission, foreground progress and confirmation naming action/target/session impact, with title-row close. Pending replaces controls until authoritative progress. Close cannot redispatch/reopen; Hide restores focus without cancellation. Reopen keeps timing; reconnect adopts work first. Show observed steps/state/elapsed, no invented percent; collapse raw detail and retain recovery.

Maintenance uses compact open rows/shared controls/distinct operation icons, aligned software/service actions, consequences in confirmation. Managed upgrade/reinstall remains available stopped/incompatible/unpaired/revoked/unreachable, authenticating host each attempt; URLs get no host controls. Configuration recovery separately confirms attachment/network loss and retained identity/archive. Retain actual errors; stale progress cannot replace new confirmation.

Incompatible cards open maintenance; managed unpaired does not force editing. Failed progress opens maintenance after popup exit without retry. Reinstall accepts validated optional binds; rebuild reviews them explicitly. Label-line errors retain geometry/accessibility. Listener repair may reinstall without another reset. Pending admission/unrelated snapshots cannot replace confirmation.

# Boundaries

Presentation neither grants authority nor proves completion.

# Evidence

- [Layout](../../desktop/scripts/check-gateway-visual-layout.mjs): geometry, peers, menus, locales, touch/large text.
- [Management](../../desktop/scripts/check-gateway-management-ui.mjs): sections/dialogs/active scroll/drafts/codes/issuance/confirmation; ten locales at390/430/768/1280px.
- [Authentication](../../desktop/scripts/check-gateway-auth-ui.mjs): ten-locale reuse,typed failure,consent.

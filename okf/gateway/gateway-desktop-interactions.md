---
type: Interaction Contract
title: Gateway Desktop interactions
tags: [gateway, desktop, interaction, validation]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Desktop enrolls Local, SSH, WSL and container Runtimes through one app session. Padded Dropdown selector/trailing Cancel opens fixed wizard;empty inventory offers recovery and wrapped/touch content retains height. Creation offers Not now/Add Gateway access.

# Contract

## Identity/enrollment
connection_id/connectionID identifies saved registrations across IPC/progress/session/Center;Web Center source_id maps to it. gateway_id/gatewayID identifies signed trust/attachments;DesktopRuntimeTargetID/placement owns lifecycle. Addresses/Cloud routes replace neither. Reject retired/ambiguous IPC fields and update peers together,preserving stored IDs/credentials/keys/schema5. One runtime_connection_target projects management/derived Cloud facts;Gateway access and Cloud capability/route/mutations/errors remain independently coordinated.

Each opening leases exact sender/target bridge and connects before fresh verification/consent. Env close retains lease;cancel/navigation/destruction/authority change retires it. Admitted writes keep transport to settlement;reject late submissions.

Try saved management/SSH/OpenSSH credentials first. Passive auth_required/missing credentials cannot preempt;only typed current auth failure reveals focused temporary credentials/Enter and ends credential-free retry. Unknown auth/Gateway/engine faults are not denial. Never save passwords/infer consent;retain credentials through admitted action/access verification,clear on completion/failure/close without observation races. Confirmed stopped offers Start;start/restart/update/reinstall share lifecycle owner. Loss stops submissions/polls,retains drafts. Explicit recovery/authority change/Settings suspension revokes verification/consent;resume fresh lease/connection with step/code drafts. Observation cannot cancel admitted work.

## Invitations/completion
Saved/manual tabs retain drafts/nodes;select enabled registration IDs. Endpoint-less entries keep guidance;use confirmed endpoints/canonical HTTPS origin,never SSH/listener. Reject changed trust,Host-rejected origin/remote loopback without hiding registrations. Inventory preserves typing;removed addresses revoke verification. Shared-address edits need manage_network/update_gateway_endpoints,never listener/restriction changes;IPC address persists until catalog change.

Admission needs explicit invite_gateway_runtime or pasted code plus Runtime verification/consent;save/select/issue is insufficient. Access-only shows admin guidance. Close/suspend/authority fences replies;success consumes code,reopen clears code/consent. Owner API always returns attachments/counts/runtime_running/observed_at_unix_ms:attachment_state durable,connection_state observed,phase presentation. Connected requires current controller;unknown/connecting/disconnected/failed/stopped differ. CLI/running Runtime share projection;counts prove no connection. Epoch71 rejects contradictions/legacy aggregates.

Success requires exact admitted non-removing attachment;unrelated/absent stays uncertain. Unknown submission queries exact membership without replay:positive completes,authoritative absence clears uncertain/consumed material and returns verification. Checks consume no code;Done restores focus. No Cloud-choice/existing-environment DTO. Replace only sole attachment;otherwise add/verify new,explicitly change Cloud route if needed,remove old.

## Management presentation
Retain toolbar,horizontal Environment/Redeven Cloud/Gateway navigation,bottom bar. Details hide search/filter/description;localized All Gateways restores search/scroll/focus. Narrow cards one column;Name/Manage opens five in-shell sections,global navigation suspends owners/retains drafts. Cards group identity/management,equal full-row Connect client/Runtime,fixed status/refresh;catalog failure outranks readiness. Anchored help avoids reflow,trust stays details. Floe geometry/touch,access-only omits enrollment. Edit/Enable/Disable/confirmed Remove disclose retained membership/service;trust/local policy separate,URLs grant no admin. Filtering retains action owners without hidden maintenance cards.

Creation separates deployment/service from pairing/transport. Save opens exact registration without connectivity proof. Include stopped/unopened managed Runtimes;other-admin reuses issuer,missing address links Network. Await modal exit. Hide keeps draft/work;reopen renews authority through card actions,no duplicate issuer/banner.

Use bounded reading width/icon toolbar/fill-weight selection. Overview leads with address/actions/collapsed identity;Clients counts/illustrated empty,narrow identity/time/actions stack;Network aligned values/maintenance,ordinary path/listener fonts/on-demand help. Exact localized time tooltips,matched input/action heights/touch,help resize next frame/cancel disposal. One availability owner clears recovered feedback without losing drafts/invalidated credentials. Visited panels mounted,only active contributes scroll;below768px full labels scroll. Dialog focus restores;all explicit locales/semantic tokens. Build inequality cannot invent actions/reinterpret rejection;reuse compatible [service](gateway-service.md).

Runtimes owns attachments/egress overrides/reevaluate/remove;Network destinations/default egress;Clients listing/revoke/current-device/fresh-key reauthorization. Management survives self-revoke. Client enrollment edits HTTPS,explicitly issues code/expiry/address and separate/combined Copy;observation retains drafts. Uncertain mutation retains operationID/review at origin;refresh cannot enable writes/clear fence. Explicit review clears fence only,no replay. Dropdown/failed refresh retain data;Settings/import grants no Runtime/Namespace authority. [Network](gateway-network-settings.md) owns validation/restart. Panels viewport-bounded,keyboard return/border-only focus;locales include Host/listener/hostname:port/plural timers. Recovery codes in details,policy feedback pairs action labels/hookIDs.

## Service actions
Card/service/network restart share admission/progress and confirmation naming action/target/session impact with title-row close. Pending replaces controls until authoritative progress. Close cannot redispatch/reopen;Hide restores focus,not cancel. Reopen retains timing,reconnect adopts work first. Show observed steps/state/elapsed,no guessed percent;raw detail collapsed/recovery retained.

Compact maintenance uses shared controls/distinct icons/aligned software-service actions and confirmed consequences. Managed upgrade/reinstall remains available stopped/incompatible/unpaired/revoked/unreachable with host authentication each attempt;URLs get no host controls. Config recovery separately confirms attachment/network loss and retained identity/archive. Stale progress cannot replace new confirmation;retain actual errors.

Incompatible cards open maintenance;managed unpaired does not force editing. Failed progress opens maintenance after popup exit without retry. Reinstall validates optional binds,rebuild reviews explicitly. Label errors retain geometry/accessibility;listener repair may reinstall without extra reset. Pending admission/unrelated snapshots cannot replace confirmation.

# Boundaries

Presentation neither grants authority nor proves completion.

# Evidence

- [Layout](../../desktop/scripts/check-gateway-visual-layout.mjs): geometry, peers, menus, locales, touch/large text.
- [Management](../../desktop/scripts/check-gateway-management-ui.mjs): sections/dialogs/active scroll/drafts/codes/issuance/confirmation; ten locales at390/430/768/1280px.
- [Authentication](../../desktop/scripts/check-gateway-auth-ui.mjs): ten-locale reuse,typed failure,consent.

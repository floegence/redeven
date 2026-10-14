---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
---
# Summary

Desktop owns Gateway enrollment/management for managed Local, SSH, WSL and container targets, including before startup/inspection. Trusted Runtime control, invitation verification and local consent remain independent. Members appear only after joining; no Runtime URL form exists. Background observations cannot change enrollment steps or cancel requests. Confirmed faults retain the current step and pause submission; explicit recovery reuses launcher operations. UI state cannot expand authority.

# Contract

## Runtime joining

Creation offers Not now or After setup, add Gateway access. Saved Local, SSH and WSL targets with a managed host connection and placement share one dialog, including containers. Unknown health, stopped processes or absent capabilities cannot hide the entry. URL-, Cloud- and Gateway-only owners cannot grant it.

Setup uses the published horizontal Stepper: Connect environment, Gateway invitation, Confirm access. Opening only inspects the target. Explicit Connect and continue must succeed through exact-target `manage_runtime_gateway status` before fields appear. Main acquires/releases the trusted bridge without opening Env App or changing lifecycle. A running, openable `forward_unavailable` target awaits connection; a genuinely blocked channel remains unavailable. Stopped targets offer Start Runtime and continue; missing control requires Refresh before Restart Runtime. Required updates offer Update Runtime. Blocked credentials, channels or container engines offer Retry and Environment settings. Explicit recovery reuses the lifecycle owner, refreshes, then checks the bridge before continuing. One compact status line presents operation progress without a nested timeline. Active work disables conflicting submissions; settings/cancellation remain available.

Gateway administrators issue signed address/code deliveries; Runtime owners verify through `manage_runtime_gateway`. Joining requires Desktop management, trusted control reachability, verified address/invitation and Runtime-local consent. Delivery or SSH/container administration cannot imply consent. Main retains tokens/host credentials; the renderer supplies only target, invitation coordinates and opaque preview ID.

Gateway provides an approved network path with separate Runtime and Cloud authority. Adding another Gateway shows no migration or Cloud ownership choices. The original card gains one Gateway tab and compact member selector; Cloud keeps its tab. Endpoint updates prove the same Gateway and preserve membership. Startup reconnects every member without this dialog. Snapshots cannot reset Cloud recovery or interaction state.

Local suggestions show a local marker, name, Use and selected-address checkmark. Multiple endpoints include host/port; accessible names/tooltips preserve addresses. Only confirmed endpoints in enabled, paired, online local-host inventory qualify; remote Runtimes exclude loopback. No scanning/guessing. Selection invalidates verification and retains/focuses code. Discovery never overwrites drafts, spends invitations or grants access. Inline identity names the target.

The upward menu retains Runtime/Cloud actions and adds Cancel Gateway pairing. Runtime/Cloud perspectives require selection among multiple members and show a sole member directly. Gateway fixes its selected member without another selector. Equivalent snapshots retain the target; absence disables confirmation. Only the selected Cloud owner shows interruption impact, which Runtime rechecks at commit. Initial Namespace enrollment is separate from route switching. Existing Cloud identity uses the unified route preflight and confirmation flow. Cloud approval, actual connection and selected route stay distinct. Management uses the trusted direct owner, never a member card.

The enrollment session owns steps, address, code, preview and pending connection/verification/join requests. Same-target background probes preserve these, DOM controls, focus, selection and reading position. Checking after a completed observation uses the retained presentation diagnosis defined by [Runtime readiness](../desktop/desktop-runtime-readiness.md); first inspection remains check-required. Background checks never show operation progress or grant live control authority.

A completed stopped, credential, engine, version or probe failure shows compact guidance in the current step and blocks submission. Only Restore connection returns to the connection step; Start, Restart and Update remain explicit lifecycle actions. Successful recovery performs exact-target trusted status again. Unexpired consent survives a read-only retry; expired consent returns to invitation verification. Runtime replacement invalidates process-local previews, including after lifecycle recovery, while retaining the draft. Active lifecycle progress belongs to its real operation key, not health freshness.

The setup wizard does not poll membership. Every command reacquires and validates its trusted connection. Observational updates neither cancel pending requests nor discard their success/failure, including a join completing alongside a fault. Submissions are deduplicated and never automatically retried. Changed target, management coordinates, invitation coordinates or purpose fence old responses; equivalent snapshots cannot reset the session. Unpairing/publication retain their own target/consent. Closing clears code/consent, fences responses and restores the menu button. Success clears the consumed code; reopening starts a fresh draft.

## Members and policy

The member dialog lists joined members and offers invitations. Administrators may issue one and select a manageable Runtime. Failed refresh retains the list and invitation; cancellation cannot reopen another dialog or discard drafts.

Default Cloud permission and member inherit/allow/deny overrides are separate. Default-change confirmation lists affected inheritors. Batch results retain successes/failures; retry submits unresolved items only. Automatic Cloud mode shows pending authorization until Namespace approval. Hook status and explicit reevaluation are visible; executable configuration stays host-only.

Host management and URL access have independent authority. Stopped registrations require explicit Start; saving/refreshing cannot start/update. Existing lifecycle confirmation/operations apply.

Settings has no editable roles or permission combinations. Verified hosts show read-only management authority and Connection settings, Runtimes and Client access tabs. URLs show consumer status without service, endpoint, member or Cloud administration. Saved client keys reconnect without another code; changed coordinates must prove pinned identity through the new connection.

Runtime invitations and Desktop client access codes are separate. Runtimes creates a ten-minute code and confirmed share addresses for Runtime-local approval, with countdown, copy, regeneration and folded guidance. Client lists show device label, enrollment and last access; labels confer no identity. Confirmed revocation affects only that client's Gateway sessions. Remove connection deletes only Desktop registration. Cloud retains its separate Connect flow.

One settings entry owns all tabs, with arrow/Home/End roving focus. Tab changes retain endpoint drafts, invitations and unexpired codes; closing discards UI drafts and restores the card control. Opening settings or importing a client code grants neither Runtime permission nor Namespace approval.

## Network settings

Connection settings separates share endpoints, listener bindings and collapsed Host restriction. Refresh retains drafts; atomic Save distinguishes immediate completion from explicit restart. No share endpoints means no invitations. Desktop coordinates save separately. [Gateway network settings](gateway-network-settings.md) owns validation, persistence and restart.

## Presentation and accessibility

Locales have explicit translations. Controls expose pointer, keyboard, focus and disabled semantics. Headers contain identity/controls; guidance belongs in the body. Cancel restores the origin/surviving owner. Narrow content wraps with visible actions and truthful operation stages.

Card menu actions share icon geometry/label alignment. Restart's power-cycle icon differs from Refresh; menu, card and confirmation use one reactive projection. Destructive/disabled styling, keyboard navigation and lifecycle confirmation stay consistent.

Settings/setup wizard use fixed, viewport-bounded panels. Tabs preserve state/geometry. Setup retains outer bounds across steps, loading and errors, with pinned header/steps/navigation and a scrolling body.

Each enrollment step places its primary action beside the relevant guidance or fields inside the body. The connection card groups Connect, lifecycle preparation or Retry with settings and inline failures; the footer contains only Back and Cancel. Verification and final consent follow the information they act on. Connection and confirmation focus their headings without scrolling past guidance; invitation entry focuses the address field. New steps start at the top, and keyboard navigation brings body actions into view.

Step labels reserve two lines; action groups reflow whole buttons. Short windows respect the Desktop titlebar; long guidance remains reachable. Target, suggestions and fields use shared compact body/control typography with distinct headings and usable text scaling/touch inputs. Cloud shares typography/spacing. Client/address rows stay compact; transport metadata stays internal. Motion respects reduced-motion preferences.

Retired configurations are rejected read-only with guidance to create a new state root and register again. They are never silently rewritten.

# Boundaries

This surface presents current Gateway state and starts explicit user-authorized operations. It does not mint membership, alter Runtime authority, infer completion from stale observations, or preserve an obsolete URL profile as an executable path.

# Evidence

- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Ten-locale narrow-screen quick fill, retained input, explicit verification and distinct network settings.

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.tsx` — Retained address/code verification and confirmation.
- `redeven:desktop/src/welcome/RuntimeGatewayConnectionsDialog.tsx` — Explicit target, Cloud impact and separate publication consent.
- `redeven:desktop/scripts/check-gateway-runtime-connections.mjs` — Ten locales and two widths across five managed placements, stable wizard bounds through loading/recovery, compact typography, short windows and enlarged text, complete production observer cycles in all steps, retained previews, focus/selection/scroll and action identity, alongside original tabs and consent.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.client.test.tsx` — Snapshot/polling draft retention and target/secret/async-response lifecycle boundaries.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` — Production Poller/HealthStore/WelcomeSnapshot updates traverse the actual Environment owner and dialog, including five-second ticks, pending requests and confirmed faults.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.tsx` — Explicit environment connection, compact recovery and horizontal enrollment steps.
- `redeven:desktop/src/shared/runtimeGatewayAccessPresentation.test.ts` — Eligibility, actual placement snapshots and recovery availability.
- `redeven:desktop/src/main/runtimeGatewayLauncher.test.ts` — Exact management target validation, lease release and independent Cloud recovery fencing.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Partial failure and retained data.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Explicit startup, recovery failures, retained previews and invitation consent.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser layout, keyboard and locale qualification.
- `redeven:desktop/scripts/check-gateway-dialog-polish.mjs` — Single settings entry, endpoint layout, client access and Cloud/Runtime dialog visuals across locales, desktop/narrow viewports and reduced-motion disclosure behavior.
- `redeven:desktop/scripts/check-gateway-permissions-ui.mjs` — Fixed host/client authority, access-code retention, revoke confirmation and localized keyboard/layout checks.
- `redeven:desktop/scripts/check-gateway-menu-ui.mjs` — Uniform menu geometry, distinct restart icons, confirmation, keyboard navigation and focus across themes, locales and viewport sizes.

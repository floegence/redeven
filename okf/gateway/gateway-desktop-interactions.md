---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Desktop owns Gateway enrollment and management presentation. All saved Desktop-managed Local, SSH, WSL and container targets expose one enrollment entry before startup or inspection. Trusted Runtime control, invitation verification and local consent remain independent requirements. Members appear only after joining; no Runtime URL form exists. Failures retain input and loaded data. Shared launcher operations own recovery, cancellation and progress; UI state cannot expand authority.

# Contract

## Runtime joining

Creation offers Not now or After setup, add Gateway access. Add Gateway access opens the same dialog for saved Local, SSH or WSL targets with a managed host connection and actual placement, including Local and SSH containers. Unknown health, stopped processes and absent capability snapshots cannot remove the entry. URL-only, Cloud-only and Gateway-only owners cannot grant it.

Add Gateway access uses the published horizontal Stepper: Connect environment, Gateway invitation, Confirm access. Opening only inspects the selected target. Gateway fields stay hidden until an explicit Connect and continue succeeds through the existing exact-target `manage_runtime_gateway status` action. The main process acquires and releases its trusted management bridge without opening an Env App or changing Runtime lifecycle. A running, openable target reporting `forward_unavailable` is awaiting this connection, not an authentication or transport failure. A genuinely blocked channel remains unavailable. Stopped targets offer Start Runtime and continue; missing control is refreshed before Restart Runtime. Required package or capability updates offer Update Runtime. Unavailable credentials, channels or container engines show Retry and Environment settings. Explicit recovery clicks reuse the exact-target lifecycle owner, refresh, and check the management connection before continuing. One compact status line reflects the existing operation; a nested lifecycle timeline is not repeated inside enrollment. Opening never changes lifecycle. Active work disables conflicting submissions while settings and cancellation remain available.

Gateway administrators issue signed address/code deliveries; Runtime owners verify them through `manage_runtime_gateway`. Delivery and SSH/container administration do not imply consent. Desktop must manage the selected Runtime, its trusted control must reach Gateway, address and invitation must verify, and the Runtime administrator must confirm locally. Main retains control tokens and host credentials; the renderer supplies only target, invitation coordinates and opaque preview ID.

Gateway provides an approved network path with separate Runtime and Cloud authority. Adding another Gateway shows no migration or Cloud ownership choices. The original card gains one Gateway tab and compact member selector; Cloud keeps its tab. Endpoint updates prove the same Gateway and preserve membership. Startup reconnects every member without this dialog. Snapshots cannot reset Cloud recovery or interaction state.

Address suggestions show a local marker, Gateway name, Use action and selected-address checkmark. Multiple endpoints include host/port; accessible names and tooltips retain full addresses. Only confirmed endpoints from enabled, paired, online local-host inventory qualify; remote Runtimes exclude loopback. No scanning or guessing occurs. Selection invalidates verification, retains and focuses the code. Discovery never overwrites drafts, spends invitations or grants access. Inline identity names the target Runtime.

The upward menu retains Runtime/Cloud actions and adds Cancel Gateway pairing. Runtime/Cloud perspectives require selection among multiple members and show a sole member directly. Gateway fixes its selected member without another selector. Equivalent snapshots retain the target; absence disables confirmation. Only the selected Cloud owner shows interruption impact, which Runtime rechecks at commit. Publish through Gateway is separate and alone offers preserve/new for existing Cloud identity. Joined, Gateway offline, Cloud denied, pending approval, published control offline, accessible and migration pending stay distinct. Management uses the trusted direct owner, never a member card.

Same-target snapshots with unchanged invitation seeds preserve address, code, pending verification, preview and focus. The mounted panel retains drafts and unexpired previews through lost control, back navigation or failed recovery, hiding later stages and pausing submissions. The setup wizard does not poll membership status; each enrollment operation reacquires and validates its own trusted connection. Unpairing/publication retain their own target and consent. Scalar target/address/code changes reset verification and fence old responses; object replacement cannot reset a session. Closing clears secrets/consent, fences responses and restores the menu button. Success clears the consumed code permanently; reopening setup starts a fresh draft.

## Members and policy

The member dialog lists joined members and offers invitations. Administrators may issue one and select a manageable Runtime. Failed refresh retains the list and invitation; cancellation cannot reopen another dialog or discard drafts.

Default Cloud permission and member inherit/allow/deny overrides are separate. Default-change confirmation lists affected inheritors. Batch results retain successes/failures; retry submits unresolved items only. Automatic Cloud mode shows pending authorization until Namespace approval. Hook status and explicit reevaluation are visible; executable configuration stays host-only.

Host management and URL access have fixed independent authority. Stopped registrations allow explicit start; saving/refreshing cannot start or update. Lifecycle uses existing confirmation and operations.

Settings has no editable roles or permission combinations. Verified hosts show read-only management authority and Connection settings, Runtimes and Client access tabs. URLs show consumer status without service, endpoint, member or Cloud administration. Saved client keys reconnect without another code; changed coordinates must prove pinned identity through the new connection.

Runtime invitations and Desktop client access codes are separate. Runtimes creates a ten-minute code and confirmed share addresses for Runtime-local approval, with countdown, copy, regeneration and folded guidance. Client lists show device label, enrollment and last access; labels confer no identity. Confirmed revocation affects only that client's Gateway sessions. Remove connection deletes only Desktop registration. Cloud retains its separate Connect flow.

One settings entry owns all tabs, with arrow/Home/End roving focus. Tab changes retain endpoint drafts, invitations and unexpired codes; closing discards UI drafts and restores the card control. Opening settings or importing a client code grants neither Runtime permission nor Namespace approval.

## Network settings

Connection settings separates share endpoints, listener bindings and collapsed Host restriction. Refresh retains drafts; atomic Save distinguishes immediate completion from explicit restart. No share endpoints means no invitations. Desktop coordinates save separately. [Gateway network settings](gateway-network-settings.md) owns validation, persistence and restart.

## Presentation and accessibility

Every locale has explicit translations. Controls expose pointer, keyboard, focus and disabled semantics. Headers contain identity/controls; descriptions belong in the body. Cancel restores the originating control or surviving owner. Narrow content wraps without hiding actions; operation stages remain truthful.

All card menu actions share icon geometry and label alignment. Restart's power-cycle icon differs from Refresh and uses the same reactive projection in menu, card and confirmation. Destructive/disabled styling, keyboard navigation and lifecycle confirmation remain consistent.

Settings uses a viewport-bounded fixed-height panel with pinned tabs and scrolling content; tabs preserve state/geometry. Enrollment keeps target identity, suggestions and pinned actions in a compact dialog. Cloud shares typography/spacing. Client/address rows stay compact; transport metadata stays internal. Motion respects reduced-motion preferences.

Rebuild notices require rejoining obsolete entries without inventing migration lists or executable legacy URL profiles.

# Boundaries

This surface presents current Gateway state and starts explicit user-authorized operations. It does not mint membership, alter Runtime authority, infer completion from stale observations, or preserve an obsolete URL profile as an executable path.

# Evidence

- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Ten-locale narrow-screen quick fill, retained input, explicit verification and distinct network settings.

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.tsx` — Retained address/code verification and confirmation.
- `redeven:desktop/src/welcome/RuntimeGatewayConnectionsDialog.tsx` — Explicit target, Cloud impact and separate publication consent.
- `redeven:desktop/scripts/check-gateway-runtime-connections.mjs` — Ten locales and two widths across five managed placements, explicit recovery, retained previews, busy controls and focus restoration, alongside original tabs and consent.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.client.test.tsx` — Snapshot/polling draft retention and target/secret/async-response lifecycle boundaries.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` — Typed and quick-filled drafts survive real launcher snapshot updates through the environment card.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.tsx` — Explicit environment connection, compact recovery and horizontal enrollment steps.
- `redeven:desktop/src/shared/runtimeGatewayAccessPresentation.test.ts` — Eligibility, actual placement snapshots and recovery availability.
- `redeven:desktop/src/main/runtimeGatewayLauncher.test.ts` — Exact management target validation, lease release and independent Cloud recovery fencing.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Partial failure and retained data.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Explicit startup, recovery failures, retained previews and invitation consent.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser layout, keyboard and locale qualification.
- `redeven:desktop/scripts/check-gateway-dialog-polish.mjs` — Single settings entry, endpoint layout, client access and Cloud/Runtime dialog visuals across locales, desktop/narrow viewports and reduced-motion disclosure behavior.
- `redeven:desktop/scripts/check-gateway-permissions-ui.mjs` — Fixed host/client authority, access-code retention, revoke confirmation and localized keyboard/layout checks.
- `redeven:desktop/scripts/check-gateway-menu-ui.mjs` — Uniform menu geometry, distinct restart icons, confirmation, keyboard navigation and focus across themes, locales and viewport sizes.

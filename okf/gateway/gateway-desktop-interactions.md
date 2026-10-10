---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-10T00:00:00Z
---
# Summary

Desktop presents Gateway members, invitations, permissions, policy and optional Redeven Cloud association. A member appears after Runtime joins; there is no form for adding a Runtime URL. Adding Gateway access uses address/code verification and confirmation; targeted unpairing and Cloud publication have separate concise confirmations. Failures retain input and previously loaded data. Shared launcher operations own cancellation, progress and focus; UI state cannot expand authority.

# Contract

## Runtime joining

Creating a managed Runtime offers Not now or After setup, add Gateway access. Joining starts only through the explicit trusted Runtime start action. A user who manages a Gateway can select it and issue a signed address-and-code delivery; the Runtime owner enters those two values and verifies them. Issuing a delivery does not silently consent or join.

Gateway access provides an approved network path; Runtime administration and optional Cloud access retain separate authority. Adding another Gateway does not show migration or Cloud ownership choices. The existing Environment card gains one Gateway tab using its original tab styling, facts area and split action footer. Multiple pairings use a compact selector inside that tab. Cloud remains its independent tab. Endpoint updates prove the same Gateway and preserve membership. Normal startup reconnects every member without this dialog; snapshots never reset Cloud recovery or interaction state.

Compact buttons below the address input show a local marker, Gateway name and Use action, with a checkmark derived from the filled address. Multiple endpoints include host and port; accessible names and tooltips retain full addresses. They use confirmed endpoints from enabled, paired, online local-host inventory only, never scan or guess addresses, and exclude loopback for remote Runtimes. Selection invalidates verification, retains and focuses the code. Discovery never overwrites drafts, consumes invitations or grants access. The target uses an inline Runtime identity.

The existing upward action menu retains Runtime and Cloud actions and adds Cancel Gateway pairing. Multiple members require an explicit target; a single member is shown directly. Only the selected Cloud owner shows a Cloud interruption warning. Runtime rechecks that impact at commit, so a changed owner cannot bypass consent. Publish through Gateway is separate and alone offers preserve/new when Cloud identity exists. Joined, Gateway offline, Cloud denied, pending approval, published control offline, accessible and migration pending remain distinct states. Address, code and target changes invalidate a preview; refresh preserves drafts. Local Runtime management remains available only through its trusted owner, never through a Gateway member card.

Drafts belong to the panel session. Same-target snapshots with unchanged invitation seeds preserve address, code, pending verification, preview and focus. Unpairing and publication keep their own selected target and confirmation state. Scalar target/address/code changes initialize the session and fence old responses; parent object identity cannot reset it. Closing clears the secret and consent but retains the address on the same panel. Success clears the consumed code, which refresh cannot restore. Reopening a closed setup dialog starts a fresh draft.

## Members and policy

The Gateway page's member dialog lists automatically joined members and offers invitations. Administrators can issue an invitation and choose one of their manageable Runtime targets. Refresh failures retain the previous list and any issued invitation. A canceled operation cannot reopen another dialog or discard the current draft.

Default Cloud permission and each member's inherit/allow/deny override are separate controls. The default-change confirmation lists affected inherited members. A batch keeps successful and failed items independently; retry submits only unresolved items. Cloud automatic mode displays pending authorization until Namespace approval exists. Script hook status and explicit reevaluation are visible; executable configuration remains host-only.

Host management and URL client access have fixed, separate authority sources. A saved registration can be started explicitly if the service is stopped. Saving or refreshing cannot implicitly start or update it. Gateway lifecycle actions continue to use the existing confirmation and operation surface.

Gateway settings has no editable roles or permission combinations. Verified host connections show a read-only host-management explanation and three tabs: Connection settings, Runtimes and Client access. URL connections show environment-consumer status and no service, endpoint, member or Cloud administration. A saved URL client's key reconnects without repeatedly asking for a code; changing connection coordinates must prove the pinned identity through the new actual connection.

Runtime invitation codes and Desktop client access codes are separate materials. The Runtimes tab creates a ten-minute code plus administrator-confirmed share addresses for a Runtime administrator's local approval, with countdown, copy and regeneration. Additional explanation is folded. The enrolled-client list shows a device label, enrollment and last access; labels never establish identity. Revocation requires explicit confirmation and affects only that client's Gateway sessions. Remove connection removes this Desktop's saved registration, not the Gateway service or Runtime. Cloud access keeps its independent Connect to Cloud flow.

The single settings entry owns all three management tabs. Keyboard arrows, Home and End select tabs with roving focus. Tab changes retain endpoint drafts, invitations and unexpired access codes; closing the window discards UI-only drafts and restores its originating card control. Runtime permissions and Cloud Namespace approval are never implied by opening settings or importing a client access code.

## Network settings

Connection settings separates administrator-confirmed Runtime share endpoints from editable local listener bindings. Listener fields show current active addresses and a next-start badge. The advanced request Host section starts collapsed, showing whether all hostnames or an explicit list is allowed. Clean fields follow authoritative catalog changes, while typed drafts survive refresh. Removing all endpoints in Connection settings immediately disables invitation issuance in the Runtimes tab. One Save network settings action persists the three network settings atomically; save feedback distinguishes immediate completion from a required explicit Gateway restart. The separate registration save owns Desktop connection coordinates and naming. [Gateway network settings](gateway-network-settings.md) owns validation, authority and migration semantics.

## Presentation and accessibility

All shipped locales have explicit translations. Interactive controls provide pointer feedback, keyboard access, visible focus and disabled semantics. Dialog headers contain identity and controls; descriptions belong in the body. Cancel restores the originating control or its surviving owner. Narrow layouts wrap content without hiding actions. Async operations show actual stages rather than invented percentages.

Every Gateway card menu action, including settings and connection removal, uses the same icon container, spacing and label alignment. Restart uses a power-cycle icon distinct from Refresh; the menu, active card action and confirmation share a reactive icon projection so labels and icons stay in sync. Destructive and disabled styling, keyboard navigation and explicit lifecycle confirmation remain unchanged.

Gateway settings use a wide, fixed-height panel bounded by the viewport, with an underlined pinned tab rail and a scrolling active panel. Tabs retain state, cross-fade and reset scroll without changing dialog geometry. Runtime enrollment uses a compact content-sized dialog with one guidance paragraph, target identity, optional address suggestions and pinned primary actions, including before startup. Cloud shares its typography, spacing and action alignment. Clients and endpoints use compact rows with consistent heading, label, help and metadata hierarchy. Share rows expose Runtime addresses only; transport metadata and failover ordering remain internal. Rows, disclosures, code results and notices animate and respect reduced motion.

The upgrade rebuild notice explains that obsolete Gateway entries must be rejoined. It does not manufacture a migration list or imply that old URL profiles remain executable.

# Boundaries

This surface presents current Gateway state and starts explicit user-authorized operations. It does not mint membership, alter Runtime authority, infer completion from stale observations, or preserve an obsolete URL profile as an executable path.

# Evidence

- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Ten-locale narrow-screen quick fill, retained input, explicit verification and distinct network settings.

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.tsx` — Retained address/code verification and confirmation.
- `redeven:desktop/src/welcome/RuntimeGatewayConnectionsDialog.tsx` — Explicit target, Cloud impact and separate publication consent.
- `redeven:desktop/scripts/check-gateway-runtime-connections.mjs` — Twenty locale/viewport cases for original tabs, upward menus, target consent and retained drafts.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.client.test.tsx` — Snapshot/polling draft retention and target/secret/async-response lifecycle boundaries.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` — Typed and quick-filled drafts survive real launcher snapshot updates through the environment card.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.tsx` — Managed creation and explicit start.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Partial failure and retained data.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Failed start and invitation consent.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser layout, keyboard and locale qualification.
- `redeven:desktop/scripts/check-gateway-dialog-polish.mjs` — Single settings entry, endpoint layout, client access and Cloud/Runtime dialog visuals across locales, desktop/narrow viewports and reduced-motion disclosure behavior.
- `redeven:desktop/scripts/check-gateway-permissions-ui.mjs` — Fixed host/client authority, access-code retention, revoke confirmation and localized keyboard/layout checks.
- `redeven:desktop/scripts/check-gateway-menu-ui.mjs` — Uniform menu geometry, distinct restart icons, confirmation, keyboard navigation and focus across themes, locales and viewport sizes.

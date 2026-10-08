---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Desktop presents Gateway members, invitations, permissions, policy and optional Redeven Cloud association. A member appears after Runtime joins; there is no form for adding a Runtime URL. The Runtime connection panel is the single local consent and recovery surface. Failures retain input and previously loaded data. Shared launcher operations own cancellation, progress and focus; UI state cannot expand authority.

# Contract

## Runtime joining

Creating a managed Runtime offers Not now or After setup, add Gateway access. Joining starts only through the explicit trusted Runtime start action. A user who manages a Gateway can select it and issue an invitation; otherwise they import an invitation file. Both feed the same Runtime join call. Issuing an invitation does not silently consent or join.

Add Gateway access describes an approved network path, not Runtime administration; Cloud remains optional. Existing Cloud environments require an explicit preserve/new choice. Replace explains possible interruption and fences the old path. Update connection endpoints accepts a fresh signed descriptor from the same Gateway while preserving membership. Normal Runtime startup reconnects without showing this dialog. Background status polling never owns or resets Cloud credential recovery, continues after transient failures, and displays Runtime publication diagnostics. It updates observations only: imported invitations, ownership choices and leave confirmations survive until an explicit operation succeeds or the user closes the panel.

The panel exposes current membership, retry, leave and replace. Joined, Gateway offline, Cloud denied, pending approval, published control offline, accessible and migration pending are distinct states. Local Runtime management remains available only through its trusted owner, never through a Gateway member card.

## Members and policy

The Gateway page's member dialog lists automatically joined members and offers invitations. Administrators can issue an invitation and choose one of their manageable Runtime targets. Refresh failures retain the previous list and any issued invitation. A canceled operation cannot reopen another dialog or discard the current draft.

Default Cloud permission and each member's inherit/allow/deny override are separate controls. The default-change confirmation lists affected inherited members. A batch keeps successful and failed items independently; retry submits only unresolved items. Cloud automatic mode displays pending authorization until Namespace approval exists. Script hook status and explicit reevaluation are visible; executable configuration remains host-only.

Host management and URL client access have fixed, separate authority sources. A saved registration can be started explicitly if the service is stopped. Saving or refreshing cannot implicitly start or update it. Gateway lifecycle actions continue to use the existing confirmation and operation surface.

Gateway settings has no editable roles or permission combinations. Verified host connections show a read-only host-management explanation and three tabs: Connection settings, Runtimes and Client access. URL connections show environment-consumer status and no service, endpoint, member or Cloud administration. A saved URL client's key reconnects without repeatedly asking for a code; changing connection coordinates must prove the pinned identity through the new actual connection.

Runtime invitations and client access codes are separate materials. The Runtimes tab creates invitations for a Runtime administrator's local approval. Client access creates a ten-minute one-use code for another Desktop, with countdown and copy. Additional explanation is folded. The enrolled-client list shows a device label, enrollment and last access; labels never establish identity. Revocation requires explicit confirmation and affects only that client's Gateway sessions. Remove connection removes this Desktop's saved registration, not the Gateway service or Runtime. Cloud access keeps its independent Connect to Cloud flow.

The single settings entry owns all three management tabs. Keyboard arrows, Home and End select tabs with roving focus. Tab changes retain endpoint drafts, invitations and unexpired access codes; closing the window discards UI-only drafts and restores its originating card control. Runtime permissions and Cloud Namespace approval are never implied by opening settings or importing a client access code.

## Presentation and accessibility

All shipped locales have explicit translations. Interactive controls provide pointer feedback, keyboard access, visible focus and disabled semantics. Dialog headers contain identity and controls; descriptions belong in the body. Cancel restores the originating control or its surviving owner. Narrow layouts wrap content without hiding actions. Async operations show actual stages rather than invented percentages.

Every Gateway card menu action, including settings and connection removal, uses the same icon container, spacing and label alignment. Restart uses a power-cycle icon distinct from Refresh; the menu, active card action and confirmation share a reactive icon projection so labels and icons stay in sync. Destructive and disabled styling, keyboard navigation and explicit lifecycle confirmation remain unchanged.

Gateway dialogs use a comfortably wide, viewport-bounded panel and the published Dialog's scrolling body. Connection addresses occupy a full-width labelled row; network scope and numeric priority have separate visible labels and stack on narrow screens. The published Select owns Gateway and endpoint-scope choice, including keyboard navigation and Escape dismissal before the enclosing dialog. Native disclosures animate height and opacity in both directions and respect reduced-motion preferences.

The upgrade rebuild notice explains that obsolete Gateway entries must be rejoined. It does not manufacture a migration list or imply that old URL profiles remain executable.

# Boundaries

This surface presents current Gateway state and starts explicit user-authorized operations. It does not mint membership, alter Runtime authority, infer completion from stale observations, or preserve an obsolete URL profile as an executable path.

# Evidence

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.tsx` — One consent and recovery form.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.tsx` — Managed creation and explicit start.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Partial failure and retained data.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Failed start and invitation consent.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser layout, keyboard and locale qualification.
- `redeven:desktop/scripts/check-gateway-dialog-polish.mjs` — Single settings entry, endpoint layout, nested selection and reversible disclosure motion.
- `redeven:desktop/scripts/check-gateway-permissions-ui.mjs` — Fixed host/client authority, access-code retention, revoke confirmation and localized keyboard/layout checks.
- `redeven:desktop/scripts/check-gateway-menu-ui.mjs` — Uniform menu geometry, distinct restart icons, confirmation, keyboard navigation and focus across themes, locales and viewport sizes.

---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Desktop presents Gateway members, invitations, permissions, policy and optional Redeven Cloud association. A member appears after Runtime joins; there is no form for adding a Runtime URL. The Runtime connection panel is the single local consent and recovery surface. Failures retain input and previously loaded data. Shared launcher operations own cancellation, progress and focus; UI state cannot expand authority.

# Contract

## Runtime joining

Creating a managed Runtime offers Not now or Join Gateway. Joining starts only through the explicit trusted Runtime start action. A user who manages a Gateway can select it and issue an invitation; otherwise they import an invitation file. Both feed the same Runtime join call. Issuing an invitation does not silently consent or join.

The confirmation describes delegated LAN access and later Cloud publication. Existing Cloud environments require an explicit preserve/new choice. Replace explains possible interruption and fences the old path. Update address accepts a fresh signed descriptor from the same Gateway while preserving membership. Normal Runtime startup reconnects without showing this dialog. Background status polling never owns or resets Cloud credential recovery, continues after transient failures, and displays Runtime publication diagnostics. It updates observations only: imported invitations, ownership choices and leave confirmations survive until an explicit operation succeeds or the user closes the panel.

The panel exposes current membership, retry, leave and replace. Joined, Gateway offline, Cloud denied, pending approval, published control offline, accessible and migration pending are distinct states. Local Runtime management remains available only through its trusted owner, never through a Gateway member card.

## Members and policy

The Gateway page's member dialog lists automatically joined members and offers invitations. Administrators can issue an invitation and choose one of their manageable Runtime targets. Refresh failures retain the previous list and any issued invitation. A canceled operation cannot reopen another dialog or discard the current draft.

Default Cloud permission and each member's inherit/allow/deny override are separate controls. The default-change confirmation lists affected inherited members. A batch keeps successful and failed items independently; retry submits only unresolved items. Cloud automatic mode displays pending authorization until Namespace approval exists. Script hook status and explicit reevaluation are visible; executable configuration remains host-only.

Pairing grants access, member management and Cloud configuration independently. A saved registration can be started explicitly if the service is stopped. Saving or refreshing cannot implicitly start or update it. Gateway lifecycle actions continue to use the existing confirmation and operation surface.

## Presentation and accessibility

All shipped locales have explicit translations. Interactive controls provide pointer feedback, keyboard access, visible focus and disabled semantics. Dialog headers contain identity and controls; descriptions belong in the body. Cancel restores the originating control or its surviving owner. Narrow layouts wrap content without hiding actions. Async operations show actual stages rather than invented percentages.

The upgrade rebuild notice explains that obsolete Gateway entries must be rejoined. It does not manufacture a migration list or imply that old URL profiles remain executable.

# Evidence

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.
- `redeven:desktop/src/welcome/RuntimeGatewayJoinPanel.tsx` — One consent and recovery form.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.tsx` — Managed creation and explicit start.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Partial failure and retained data.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Failed start and invitation consent.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser layout, keyboard and locale qualification.

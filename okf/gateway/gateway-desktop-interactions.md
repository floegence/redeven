---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

Desktop owns Gateway enrollment/management for managed Local, SSH, WSL and container targets, including before startup/inspection. Trusted Runtime control, invitation verification and local consent remain independent. Members appear only after joining; no Runtime URL form exists. Background observations cannot change enrollment steps or cancel requests. Confirmed faults retain the current step and pause submission; explicit recovery reuses launcher operations. UI state cannot expand authority.

# Contract

## Runtime joining
Creation offers Not now or After setup, add Gateway access. Unknown health, stopped processes or absent capabilities cannot hide the entry.

The setup wizard explicitly connects the selected environment before invitation verification and consent. Opening an Env App window in the past does not prove a current management connection. Gateway enrollment owns a separate, sender-bound bridge lease for the entire dialog opening; closing an Env App window cannot release that lease. Dialog cancellation, renderer navigation/destruction, or changed target authority releases it. Already admitted writes retain transport until their response settles, and late requests from a closed opening cannot reconnect it.

When a password-mode SSH target needs authentication, the wizard requests its password inline, focuses the field and supports Enter to retry. Authentication rejection remains distinct from Gateway or container-engine failure. Only a scoped status request accepts the temporary password; it overrides stored credentials for this connection without updating preferences, and verification/consent commands never carry it. The renderer clears the password after connection, failure or closure. Connection loss preserves the current step and invitation drafts, blocks submission and requires explicit reconnection; previously verified consent must be verified again. Reopening creates a new connection scope.

When eligible saved local Gateways exist, invitation address sources are separated into tabs for saved Gateways and manual entry. The saved tab uses only confirmed Gateway share addresses from `member_endpoints`; its selection does not verify or authorize access. The manual address draft remains in its own tab, and changing the active address invalidates any prior verification. Gateway invitation verification and explicit Runtime consent remain required.

Success clears the consumed code; reopening starts a fresh draft.

## Members and policy
The member dialog lists joined members and offers invitations. Failed refresh retains the list and invitation; cancellation cannot reopen another dialog or discard drafts.

Opening settings or importing a client code grants neither Runtime permission nor Namespace approval.

## Network settings
Connection settings separates share endpoints, listener bindings and collapsed Host restriction. [Gateway network settings](gateway-network-settings.md) owns validation, persistence and restart.

## Presentation and accessibility
Locales have explicit translations.

Settings/setup wizard use fixed, viewport-bounded panels.

They are never silently rewritten.

# Boundaries

This surface presents current Gateway state and starts explicit user-authorized operations. It does not mint membership, alter Runtime authority, infer completion from stale observations, or preserve an obsolete URL profile as an executable path.

# Evidence

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten locales at 390px plus Chinese at desktop width; password retry/focus, connection loss, draft retention, explicit consent, cancellation and fresh reopening.
- `redeven:desktop/src/main/environmentManagementConnections.test.ts` and `redeven:desktop/src/main/runtimeGatewayLauncher.test.ts` — Sender/target ownership, transient authentication, shared leases, delayed cancellation and release after admitted operations.
- `redeven:desktop/src/welcome/RuntimeGatewaySetupDialog.client.test.tsx` — Inline password recovery and preserved enrollment state.

- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Ten-locale narrow-screen source tabs, independent address drafts, explicit verification and distinct network settings.

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.

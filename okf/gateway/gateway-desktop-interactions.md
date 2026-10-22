---
type: Interaction Contract
title: Gateway Desktop interactions
description: Invite Runtime members and manage policy with explicit consent, retained drafts and truthful status.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns Gateway enrollment/management for managed Local, SSH, WSL and container targets, including before startup/inspection. Trusted Runtime control, invitation verification and local consent remain independent. Members appear only after joining; no Runtime URL form exists. Background observations cannot change enrollment steps or cancel requests. Confirmed faults retain the current step and pause submission; explicit recovery reuses launcher operations. UI state cannot expand authority.

# Contract

## Runtime joining
Creation offers Not now or After setup, add Gateway access. Unknown health, stopped processes or absent capabilities cannot hide the entry.

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

- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Ten-locale narrow-screen quick fill, retained input, explicit verification and distinct network settings.

- `redeven:desktop/src/welcome/GatewayClientsPanel.tsx` — Client enrollment, countdown and confirmed revocation.

- `redeven:desktop/src/welcome/GatewayMembersDialog.tsx` — Invitations, policies, partial results and reevaluation.

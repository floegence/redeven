---
type: Interaction Contract
title: Gateway Desktop interactions
description: Gateway enrollment, connection ownership and consent.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

Desktop enrolls managed Local, SSH, WSL and container targets. Runtime management, invitation verification and local consent are separate authority checks. Members appear only after joining; no Runtime URL form exists. Observations preserve steps and drafts; confirmed faults require explicit recovery.

# Contract

## Connection and enrollment

Creation offers Not now or After setup, add Gateway access before inspection/startup. Connection precedes verification and consent; prior Env App opening does not prove a live connection.

Each dialog opening owns a sender/target-bound bridge lease across all steps. Env App closure cannot release it. Cancellation, renderer navigation/destruction or target authority changes release the lease and reject late requests; admitted writes retain transport until settlement.

Password-mode SSH authentication is inline, focused and Enter-submittable. Rejection stays distinct from Gateway/container-engine failure. Only scoped status accepts a temporary password; it overrides saved credentials for that connection without updating preferences. Verification/consent never carry it. Clear the renderer password after connection, failure or closure. Reopening creates a fresh scope.

Connection loss blocks submission and polling; explicit recovery retains drafts and uses the original lifecycle owner. Lost connection or changed authority requires fresh verification. Observations never cancel pending requests.

Saved-address and manual-entry tabs preserve independent drafts. Suggestions use confirmed share addresses from member_endpoints; selection grants no authority. Address changes invalidate verification. Success clears the consumed code; reopening clears consent and code.

## Management and presentation

Member dialogs list members, issue invitations and manage policy. Refresh failure retains lists/invitations; cancellation cannot reopen dialogs or discard drafts. Settings/client-code import grant no Runtime permission or Namespace approval. [Network settings](gateway-network-settings.md) separates share endpoints, listeners and collapsed Host restrictions and owns validation/restart.

Use explicit translations and viewport-bounded panels.

# Boundaries

UI state and observations cannot expand authority or imply completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection and consent flows.
- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Address tabs and network settings.
- `redeven:desktop/src/main/environmentManagementConnections.test.ts` — Lease ownership, cancellation and admitted writes.

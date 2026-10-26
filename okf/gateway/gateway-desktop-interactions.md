---
type: Interaction Contract
title: Gateway Desktop interactions
description: Gateway enrollment, connection ownership and consent.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop enrolls managed Local, SSH, WSL and container targets. Runtime management, invitation verification and local consent are separate authority checks. Members appear only after joining; no Runtime URL form exists. Observations preserve steps and drafts; confirmed faults require explicit recovery.

# Contract

## Connection and enrollment

Creation offers Not now or After setup, add Gateway access before inspection/startup. Connection precedes verification and consent; prior Env App opening does not prove a live connection.

Creation and every Environment card open one app-owned enrollment session. Cards own no parallel enrollment dialog, recovery dispatch or authentication state. Settings suspends that same session, and closure restores the originating control.

Each dialog opening owns a sender/target-bound bridge lease across all steps. Env App closure cannot release it. Cancellation, renderer navigation/destruction or target authority changes release the lease and reject late requests; admitted writes retain transport until settlement.

Connection first acquires an independent lease on the exact Env App bridge, or attempts the saved management channel with available SSH transport/OpenSSH authentication. A passive `auth_required` diagnosis or absent saved password cannot require password entry before this attempt. Only a current authentication failure shows the inline, focused, Enter-submittable password field; it stops credential-free retries. Rejection stays distinct from Gateway/container-engine failure. Among enrollment commands, only scoped status accepts a temporary password; it overrides saved credentials for that connection without updating preferences. Verification/consent never carry it. Clear the renderer password after connection, failure or closure. Reopening creates a fresh scope and retries available authentication.

When authenticated inspection proves the Runtime or its container is stopped, show an explicit startup action. Start, restart and update use one lifecycle dispatch adapter and the existing lifecycle owner. They first try available authentication; only a typed SSH authentication failure requests a temporary password through the same state and input used for connection. Pass it unchanged through lifecycle execution and access verification, never persist it, and clear it after settlement. Successful recovery invalidates consent before reconnecting; a startup observation cannot interrupt its owning action or race password clearing. Opening or connecting never implicitly starts a Runtime.

Connection loss blocks submission and polling; explicit recovery retains drafts and uses the original lifecycle owner. Lost connection or changed authority requires fresh verification. Observations never cancel pending requests.

Saved-address and manual-entry tabs preserve independent drafts and input nodes. The picker uses enabled registrations saved on this Desktop across URL, local/SSH host and container kinds; observed connectivity and listener state do not hide known addresses or clear selection. Prefer confirmed member_endpoints; before catalog sync, a saved URL may supply a canonical HTTPS origin (an optional root slash is removed). Never infer share addresses from SSH or listener coordinates. Reject revoked/changed trust, invalid origins, Host-rejected addresses and loopback for remote targets. Late inventory defaults untouched empty entry to saved selection without replacing a typed draft or its focus. Removing an eligible selected address invalidates verification. Selection grants no authority: the target Runtime still verifies reachability, identity and invitation before explicit consent. Success clears the consumed code; reopening clears consent and code.

## Management and presentation

Member dialogs list members, issue invitations and manage policy. Refresh failure retains lists/invitations; cancellation cannot reopen dialogs or discard drafts. Settings/client-code import grant no Runtime permission or Namespace approval. [Network settings](gateway-network-settings.md) separates share endpoints, listeners and collapsed Host restrictions and owns validation/restart.

Internal enrollment checks use inline feedback, without status-refreshed toasts. Unknown status never implies rejected credentials; expandable technical details retain the actual diagnosis. Opening Environment settings suspends enrollment, releases its connection and invalidates verification while preserving invitation drafts and the current step. Returning requires a fresh connection before submission.

Use explicit translations and viewport-bounded panels.

Gateway service confirmation presents the action, target and affected sessions without a diagnostic inventory. Its close icon shares the title row. Admission replaces confirmation controls with a pending state until authoritative operation progress arrives; it cannot resubmit the same action.

Service progress prioritizes observed step labels, current-step state and elapsed time. It never invents future steps or a completion percentage. Raw service detail is optional, collapsed diagnostics after the timeline; failures retain their concise recovery summary and separate technical details. Confirmation and progress share a stable card trigger and explicit close control: closing hides the panel, restores trigger focus and leaves the operation running. Reopening retains its steps and timing without dispatching another request. After launcher reconnection, a running service operation takes precedence over a new confirmation: the card adopts that operation's owner and opens its existing progress.

# Boundaries

UI state and observations cannot expand authority or imply completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection reuse, authentication failure and consent flows.
- `redeven:desktop/src/main/runtimeGatewayLauncher.test.ts` — Exact Env App bridge reuse, independent ownership and explicit SSH authentication.
- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Address tabs and network settings.
- `redeven:desktop/src/main/environmentManagementConnections.test.ts` — Lease ownership, cancellation and admitted writes.
- `redeven:desktop/src/welcome/GatewaySetup.client.test.tsx` — Confirmation, admission, observed service steps and stable trigger continuity.
- `redeven:desktop/scripts/check-gateway-card-experience.mjs` — Update progress, collapsed diagnostics, title-row close controls and viewport bounds at desktop and narrow widths.

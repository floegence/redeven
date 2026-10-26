---
type: Interaction Contract
title: Gateway Desktop interactions
description: Gateway enrollment, connection ownership and consent.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
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

Saved-Gateway and manual-entry tabs preserve independent drafts and input nodes. Selection belongs to the enabled saved registration ID across URL, local/SSH host and container kinds, never to an address or observed connectivity. Retain records with no usable endpoints and show inline address setup. Prefer confirmed member_endpoints; a URL registration without catalog endpoints may use its canonical HTTPS origin. Never infer addresses from SSH or listener coordinates. Reject revoked/changed trust, invalid origins, Host-rejected addresses and loopback for remote targets without hiding otherwise eligible registrations. Late inventory cannot replace typed input or focus; removal of a selected usable address revokes verification.

For host-managed Gateways with manage_members permission, the enrollment owner saves a reachable address through update_gateway_endpoints, preserving existing endpoints, listeners and Host restrictions. The IPC response returns the authoritative endpoint list; retain that delivery only until the catalog changes, never resurrect removed endpoints. The user explicitly generates an invitation through invite_gateway_runtime or pastes an existing code. Saving, selection and invitation issuance never enroll a Runtime. URL/access-only connections explain how to obtain an address and code from the administrator. Changed authority, closure and suspension reject late responses; observations preserve pending actions. Runtime verification and explicit consent remain mandatory. Success consumes the code; reopening clears consent and code.

## Management and presentation

Readiness follows the observed service and verified Gateway protocol, not equality with the Desktop build. Refresh, pairing and invitation issuance reuse compatible installed Gateways. Package repair must never produce a start-required error. Pairing rejection cannot be reclassified as an update requirement from release or commit differences; [Gateway service](gateway-service.md) owns compatibility and package integrity.

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

- `redeven:desktop/scripts/check-gateway-enrollment-electron.mjs` — Isolated product Desktop, real Gateway and Runtime: empty-address selection, persisted endpoint, signed invitation, verification, explicit consent, connected membership and owned cleanup.

---
type: Interaction Contract
title: Gateway Desktop interactions
description: Gateway enrollment, connection ownership and consent.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
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

## Welcome task ownership

Preserve the existing Welcome toolbar, horizontal Environment / Redeven Cloud / Gateway navigation, search and filters, full-width Gateway cards and bottom status bar. Gateway management stays inside the existing modal, with Overview, Clients, Runtimes, Redeven Cloud and Settings groups. Cards expose parallel Connect client / Connect Runtime actions and retain Refresh, service recovery and the complete contextual menu. The Gateway name opens Overview; Gateway settings opens Settings directly, and Cloud remains available from the contextual menu. The groups do not create another top-level workspace. Clients and Cloud have independent lazy initialization and check host management and Cloud capability independently; URL connections never inherit host management from stale permissions.

Creation starts with an explicit existing-service or new-deployment intent. URL pairing and host/container preparation have separate transport choices. A successful save returns the exact saved registration ID and leads to its overview, with observed status and the next supported service action. Saving a connection never claims deployment or connectivity; starting remains explicit through the existing lifecycle executor.

Gateway-side Connect Runtime first distinguishes a Runtime managed by this Desktop from one managed by another administrator. The first choice and environment-side Add Gateway access enter one application-owned enrollment session, preselecting the corresponding object. The second choice exposes the existing invitation issuer in the Runtimes section; missing addresses link to the existing network editor, without creating a second issuer. The picker includes stopped and unopened managed environments. The old member-dialog nested enrollment is removed. Switching between management and enrollment waits for the outgoing modal presence to finish; drafts and return context survive. Hiding enrollment retains its draft and any admitted submission. Reopen it through the existing Environment card Add Gateway access or Gateway Connect Runtime action; no global resume banner or extra Welcome content row is added. Resumption reacquires the management connection and revokes obsolete consent rather than reusing a released lease.

An accepted enrollment shows a result instead of immediately disappearing. Membership and live connectivity remain distinct. An uncertain submission queries the exact Gateway membership; it cannot submit the same invitation again. A positive status completes the result; an authoritative absence clears consumed/uncertain invitation material and returns to verification. Ordinary checks never consume invitations. Done returns to the initiating context.

## Management and presentation

Management keeps a stable dialog height, fixed navigation and footer, and one scroll container sized by the active tab alone. Inactive panels stay mounted to retain drafts and issued codes but generate no layout boxes or scroll overflow. Switching tabs starts at the top and animates the entering panel; reduced motion disables that animation. Expanding or collapsing details updates the same scroll extent without leaving a blank tail. Enrollment navigation restores focus to the active field, choice or initiating control. Ready empty cards show their count without an instructional banner.

Readiness follows the observed service and verified Gateway protocol, not equality with the Desktop build. Refresh, pairing and invitation issuance reuse compatible installed Gateways. Package repair must never produce a start-required error. Pairing rejection cannot be reclassified as an update requirement from release or commit differences; [Gateway service](gateway-service.md) owns compatibility and package integrity.

The Runtimes group keeps membership, per-member Cloud overrides, recheck and removal; global Cloud policy belongs to Redeven Cloud. Client enrollment prepares an editable HTTPS address and requires explicit access-code issuance. Opening an entry never creates a code. The delivery exposes the code, expiry and address with separate or combined copying; returning to Clients retains its draft and code. Observational endpoint updates do not overwrite the address. Clients remains the sole owner of listing and confirmed revocation. Member, publication and endpoint choices share the published Dropdown. Refresh failure retains lists/invitations; cancellation cannot reopen dialogs or discard drafts. Settings/client-code import grant no Runtime permission or Namespace approval. [Network settings](gateway-network-settings.md) separates share endpoints, listeners and collapsed Host restrictions and owns validation/restart.

Internal enrollment checks use inline feedback, without status-refreshed toasts. Unknown status never implies rejected credentials; expandable technical details retain the actual diagnosis. Opening Environment settings suspends enrollment, releases its connection and invalidates verification while preserving invitation drafts and the current step. Returning requires a fresh connection before submission.

Use explicit translations and viewport-bounded panels. Saved Gateway and endpoint pickers use the published shared Dropdown with its field-surface marker, keyboard navigation and focus restoration. Focus changes the existing border color without adding an outer frame; native selects and parallel menu behavior do not belong to this enrollment flow. Settings and enrollment address inputs share an explicit HTTPS hostname-and-port example from every locale catalog. Listener and Host examples also belong to every explicit locale catalog. Invitation countdowns use locale plural rules. Member-operation failures show localized recovery text; raw error codes remain in collapsed technical details, including unknown future codes. Policy checks pair localized action names with their technical hook identifiers.

Settings maintenance and card actions share the same foreground action owner, admission and progress renderer. Maintenance replaces the management body in the same modal; Back closes its presentation without reopening a card popover or dispatching again. Network restart review uses this same operation surface. Gateway service confirmation presents the action, target and affected sessions without a diagnostic inventory. Its close icon shares the title row. Admission replaces confirmation controls with a pending state until authoritative operation progress arrives; it cannot resubmit the same action.

Service progress prioritizes observed step labels, current-step state and elapsed time. It never invents future steps or a completion percentage. Raw service detail is optional, collapsed diagnostics after the timeline; failures retain their concise recovery summary and separate technical details. Confirmation and progress share a stable card trigger and explicit close control: closing hides the panel, restores trigger focus and leaves the operation running. Reopening retains its steps and timing without dispatching another request. After launcher reconnection, a running service operation takes precedence over a new confirmation: the card adopts that operation's owner and opens its existing progress.

# Boundaries

UI state and observations cannot expand authority or imply completion.

# Evidence

- `redeven:desktop/scripts/check-gateway-permissions-ui.mjs` — Active-only scroll extent across ten locales and desktop, narrow and short viewports; expanded/collapsed details, retained drafts/codes and stable dialog geometry.
- `redeven:desktop/src/shared/i18n/desktopI18n.test.ts` — Explicit ten-locale catalogs, placeholders, dynamic Gateway states, and invitation plural forms.
- `redeven:desktop/src/welcome/GatewayMembersDialog.client.test.tsx` — Ten-locale member errors, collapsed diagnostics, policy labels, and invitation timers.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` — Browser checks for localized errors, expiry, policy labels, and bounded multilingual layouts.

- `redeven:desktop/scripts/check-gateway-auth-ui.mjs` — Ten-locale connection reuse, authentication failure and consent flows.
- `redeven:desktop/src/main/runtimeGatewayLauncher.test.ts` — Exact Env App bridge reuse, independent ownership and explicit SSH authentication.
- `redeven:desktop/scripts/check-gateway-network-ui.mjs` — Address tabs and network settings.
- `redeven:desktop/src/main/environmentManagementConnections.test.ts` — Lease ownership, cancellation and admitted writes.
- `redeven:desktop/src/welcome/GatewaySetup.client.test.tsx` — Confirmation, admission, observed service steps and stable trigger continuity.
- `redeven:desktop/scripts/check-gateway-card-experience.mjs` — Update progress, collapsed diagnostics, title-row close controls and viewport bounds at desktop and narrow widths.

- `redeven:desktop/scripts/check-gateway-enrollment-electron.mjs` — Isolated product Desktop, real Gateway and Runtime: direct card enrollment, empty-address selection, persisted endpoint, signed invitation, verification, explicit consent, connected membership, explicit client-code issuance and retention, and owned cleanup.

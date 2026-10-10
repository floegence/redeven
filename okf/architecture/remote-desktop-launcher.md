---
type: Interaction Contract
title: Remote desktop connection launcher
description: Identify the target host, explain connection readiness and open its desktop through one concise, localized flow.
tags: [desktop, applications, interaction, accessibility]
timestamp: 2026-10-09T17:00:00Z
---
# Summary

The Env App launcher owns the remote desktop connection flow in Host Applications
and Workbench. It names the actual target, presents current readiness and offers
one primary action. Additional authorization advances inside that same surface.
Permission and platform limits remain enforced by the
[desktop session contract](remote-desktop.md). Failure stays visible with an
appropriate recovery step; dismissal before session creation finishes releases
that session. A successfully opened viewer retains its independent lifetime.

# Contract

## Target and readiness

The launcher identifies the target using Desktop's connection label when present.
In a browser connected to Local UI it uses the Runtime's reported hostname, never
the generic `Local Environment` name. Cloud environment names remain user-defined.
The same identity is sent to the viewer. Status checks are not presented as a
connection in progress. Unavailable desktops cannot be launched; locked desktops
can be opened only when the host advertises secure login/lock-screen access.
Wayland authorization-required is actionable but does not mean a prompt is already
open. Connection creates the session, opens its viewer and attaches both native
channels before the host receives a system sharing request. Window admission
failure must not continue instructing the user to confirm a nonexistent prompt.
Missing macOS screen/input grants expose only the relevant permission actions. View-only mode
can omit input permission but never omits full environment authorization.

Component preparation stays inside the launcher through checking, download,
installation and validation. Unknown byte totals render an indeterminate native
progress bar by omitting its numeric value attribute; known totals show byte
progress. Moving between these states must not throw a rendering exception or
replace the host application page with its error boundary. Status polling makes
connection available after preparation succeeds. Failure retains its diagnostic
and retry action, while cancellation stops only the selected setup operation;
neither requires reloading the application.

## Continuous connection setup

When a target needs SSH service preparation, authorization and desktop opening
remain one continuous flow in the existing Remote desktop dialog. The panel
advances in place through authorization, host preparation and connection; it
does not open a second dialog or return to the initial connection form between
steps. The current step, retained authorization input state, progress, failure
diagnostic and next action stay visible together. A completed service-management
action shows its result until the user returns to connection options. A connect
action continues automatically to viewer admission after successful preparation.
If preparation succeeds but capture remains unavailable, the same failure step
names the host reason and offers Refresh. Refresh never silently opens a desktop.
Connect appears only after current host capability admits it, and transient
connection failures can retry without repeating administrator authorization.
Cancellation, retry and recovery use the same surface and restore focus
to the action that started the flow.

Control takeover and saved-approval removal follow the same in-place step model.
They do not stack a confirmation dialog over the launcher. Escape cancels the
current in-place confirmation, and closing while a connection or deployment is
pending cancels the owner and releases any late session response.

Content enters with a short fade and small vertical movement. Step indices keep
their alignment, long localized actions remain readable at 320 CSS pixels, and
reduced-motion preferences stop both transition and spinner animations. Host
identity remains visible throughout. Administrator scope and credential lifetime
follow the [SSH deployment contract](remote-desktop-ssh-deployment.md).

## Connection options

The initial dialog presents host identity, readiness and one connect action. A
display selector appears only when multiple displays are known. Connection options
are collapsed by default and contain view-only mode. Wayland hosts that support
persistent portal grants expose **Connect automatically after first approval**.
The default is enabled under the [authorization policy](remote-desktop-authorization.md).
Opening the launcher never changes system permission. A first connection still
needs the host user's confirmation; subsequent connections attempt the saved
grant. The Runtime must be running in the logged-in desktop. macOS and X11 do
not display this portal-specific option. Older portals explain that automatic
recovery is unsupported while keeping temporary sharing available.

Saving disables connection until the host accepts the setting; failure restores
the actual value. Readiness comes from the upstream authorization state: saved,
restoring, needs consent, revoked or uncertain. Enabling the preference alone
never claims approval was saved or that a system prompt is visible. A pending
request explains that any system sharing dialog must be confirmed on the host.

Connection options include **Request approval again** for a saved or uncertain
Wayland grant. A confirmation explains that this clears only local recovery
credentials, not system permissions or active sharing. A competing authorization
request reports that it must finish or be cancelled first. Focus returns to the
trigger after dismissal. Turning off reuse means each future connection requests
host confirmation; it does not revoke the system grant.

# Boundaries

## Failure and window ownership

Status refreshes never erase a connection failure. Feedback names the failed
action, explains the next step and can disclose the structured error code/HTTP
status without exposing response bodies or credentials. Desktop window rejection
retains its IPC diagnostic under Error details; the primary explanation names the
window stage and states that host sharing has not yet been requested. Pop-up denial
creates no session. Viewer-open failure and dismissal before creation completes release the
new session. Successful window opening dismisses the launcher; a launched viewer
outlives that dialog. Workbench uses the same panel in its local scroll viewport.
Native dialog focus restoration, localized stable button widths and all shipped
themes remain part of the connection contract.

The session API returns the exact registered loopback **origin** in `target_url`.
The viewer path is carried separately in navigation (`/_redeven_desktop/`). Desktop
retains origin-only target validation and environment-scoped route admission;
product adapters must not weaken either boundary to accept malformed session data.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx`: target identity, state-derived actions, settings and window lifecycle.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.test.tsx`: connection failure retention, display selection, takeover and cancellation.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.browser.test.tsx`: same-dialog stage progression, masked pending credentials, responsive actions and reduced motion.
- `internal/envapp/ui_src/src/styles/remoteDesktopLauncher.browser.test.tsx`: shipped locales/themes, narrow layout, keyboard navigation and settings rollback.
- `internal/envapp/ui_src/src/ui/services/graphicalSessionTransport.test.ts`: management and window admission use the active Flowersec carrier.
- `internal/envapp/ui_src/src/ui/pages/remoteDesktopLaunchContract.test.tsx`: production API client, route opener and Desktop validator exercised together.
- `internal/remotedesktop/manager_test.go`: actual session/forward origin identity and target ownership.

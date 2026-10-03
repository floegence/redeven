---
type: Interaction Contract
title: Remote desktop connection launcher
description: Identify the target host, explain connection readiness and open its desktop through one concise, localized flow.
tags: [desktop, applications, interaction, accessibility]
timestamp: 2026-10-03T03:30:00Z
---
# Summary

The Env App launcher owns the remote desktop connection flow in Host Applications
and Workbench. It names the actual target, presents current readiness and offers
one primary action. Permission and platform limits remain enforced by the
[desktop session contract](remote-desktop.md). Failure stays visible with an
appropriate recovery step; dismissal before session creation finishes releases
that session. A successfully opened viewer retains its independent lifetime.

# Contract

## Target and readiness

The launcher identifies the target using Desktop's connection label when present.
In a browser connected to Local UI it uses the Runtime's reported hostname, never
the generic `Local Environment` name. Cloud environment names remain user-defined.
The same identity is sent to the viewer. Status checks are not presented as a
connection in progress, and unavailable or locked desktops cannot be launched.
Wayland authorization-required is actionable but does not mean a prompt is already
open. Connection creates the session, opens its viewer and attaches both native
channels before the host receives a system sharing request. Window admission
failure must not continue instructing the user to confirm a nonexistent prompt.
Missing macOS screen/input grants expose only the relevant permission actions. View-only mode
can omit input permission but never omits full environment authorization.

## Connection options

The initial dialog presents host identity, readiness and one connect action. A
display selector appears only when multiple displays are known. Connection options
are collapsed by default and contain view-only mode and, where supported, explicit
opt-in to **Remember sharing approval**. This is the existing host-wide OS-grant
reuse setting, not permission to unlock or a promise of unattended availability.
Saving is pending until the host accepts it; failure restores the actual setting.

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
- `internal/envapp/ui_src/src/styles/remoteDesktopLauncher.browser.test.tsx`: shipped locales/themes, narrow layout, keyboard navigation and settings rollback.
- `internal/envapp/ui_src/src/ui/services/graphicalSessionTransport.test.ts`: management and window admission use the active Flowersec carrier.
- `internal/envapp/ui_src/src/ui/pages/remoteDesktopLaunchContract.test.tsx`: production API client, route opener and Desktop validator exercised together.
- `internal/remotedesktop/manager_test.go`: actual session/forward origin identity and target ownership.

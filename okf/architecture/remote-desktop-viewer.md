---
type: Interaction Contract
title: Remote desktop viewer interaction
description: Operate the remote desktop toolbar, input modes and ended-session recovery consistently in browsers and Desktop.
tags: [desktop, viewer, interaction, input]
timestamp: 2026-10-13T21:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Redeven viewer owns product controls and local feedback over published Floe
input and native playback. The [remote desktop session contract](remote-desktop.md)
owns authorization, capture generations and native authority. Only current painted
control permits input. Separate-cursor control frames enable immediate client
pointer movement independently of later frame arrival; embedded-cursor frames
hide the local pointer. Local controls remain usable during recovery. Disconnect
stops local input and playback immediately, then confirms server removal or offers
an explicit retry. It never presents a frozen desktop as a live connection.

# Contract

## Input and clipboard
The published Floe input and pointer controllers own client composition, physical keys, pointer gestures and release. Mouse and drag movement retains only the latest pending position, bounded to 120 submissions per second.

This desktop-only policy does not apply to host application windows, which use their own upstream cursor contract.

## Toolbar and window
Desktop opens an isolated owned window; browsers open a separate viewer. Ended sessions explain how to start a new connection from the launcher and never expose an ineffective Reconnect action.

Explicit Disconnect closes that device; an enabled sound toggle must never hide a closed audio context after reconnect.

# Boundaries

The [connection launcher](remote-desktop-launcher.md) owns target identity, readiness, preparation, grant-reuse settings and launch feedback. The [session contract](remote-desktop.md) owns authorization, capture generations and native authority; viewer controls cannot substitute for painted control authority.

# Evidence

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/codeapp/appserver/remote_desktop_viewer/viewer.html`: control state, input mapping, modal focus and disconnect lifecycle.

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.css`: responsive grouped toolbar, visible action states, hidden retired pictures and native chrome insets.

- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published Floe icons and input controllers, explicit locale catalogs.

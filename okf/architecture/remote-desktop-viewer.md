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

Redeven controls/feedback use published input/playback; session contracts own authorization and capture generations. Only painted current control admits input. Separate cursor frames permit immediate pointer motion; embedded cursor hides local pointer. Recovery keeps local controls usable. Disconnect stops input/media, confirms removal or offers Retry; frozen pixels never imply connection.

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

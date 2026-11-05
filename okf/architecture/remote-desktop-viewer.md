---
type: Interaction Contract
title: Remote desktop viewer interaction
tags: [desktop, viewer, interaction, input]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published input/playback and session contracts own current-frame authority. Separate cursors permit immediate movement; embedded cursors hide local pointer. Recovery keeps controls usable; disconnect stops media/input with confirmed removal or Retry. Frozen pixels never imply connection.

When a lock-screen frame is painted and acknowledged in control mode, the viewer
arms physical-only unlock input automatically. Paint and acknowledgement may
arrive in either order; both paths attempt arming, and subsequent acknowledgements
must not steal focus. The host lock screen remains unobscured, and a rate-limited
interaction explains the wait instead of claiming that authentication failed.
Opening a panel, losing the socket, changing generation or mode, and every
unpainted transition revoke the armed target. Backend frame, generation, control
owner and physical-input checks remain mandatory for every unlock event.

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

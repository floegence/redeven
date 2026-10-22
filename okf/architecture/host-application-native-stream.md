---
type: Interaction Contract
title: Native Linux host application picture streams
description: Negotiate efficient native pictures and compose bounded regions without changing input authority, application geometry or process identity.
tags: [applications, linux, display, performance]
timestamp: 2026-09-29T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Native Apps owns native capture, region encoding and browser
composition. Redeven maps picture preferences and displays measured statistics.
Only successfully composed pixels authorize input and acknowledgement. Quality
changes preserve application and connection identity. Incompatible or malformed
frames require explicit recovery; surviving legacy sessions remain viewable.
The [display contract](host-application-display.md) owns application geometry.

# Contract

The picture panel offers Automatic, Clarity first, Motion first and Save data. Preferences survive reload; selecting the current mode, changing locale or theme never reconnects the application.

The [performance guide](../operations/host-application-performance.md) owns workload, measurement, thresholds and the limits of any responsiveness claim.

## Remote cursor geometry
Published `floe-native-apps` prepares the only Linux cursor owner. Remote PNG shapes, alpha and complete bounds are retained; their longest edge is at most 24 CSS pixels and smaller images are never enlarged.

New sharing connections use current cursor resources while preserving application identity. macOS native applications retain the client's existing cursor.

# Boundaries

Picture mode changes use the authenticated current attachment. Renderer requests cannot choose a codec implementation, binary, capture executable or installation. The native component and browser decoder must come from the same published SDK contract; no product-local codec or patch parser is maintained.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/linux.js`: preferences, negotiation, painted-target binding and statistics.

- `internal/hostapps/desktop_transport.go`: authenticated capability forwarding and attachment ownership.

- `internal/codeapp/appserver/host_applications.go`: published decoder resource integration.

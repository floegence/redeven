---
type: Interaction Contract
title: Native Linux host application picture streams
description: Negotiate efficient native pictures and compose bounded regions without changing input authority, application geometry or process identity.
tags: [applications, linux, display, performance]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

Published Floe Native Apps owns native capture, region encoding and browser
composition. Redeven maps picture preferences and displays measured statistics.
Only successfully composed pixels authorize input and acknowledgement. Quality
changes preserve application and connection identity. Incompatible or malformed
frames require explicit recovery; surviving legacy sessions remain viewable.
The [display contract](host-application-display.md) owns application geometry.

# Contract

The picture panel offers Automatic, Clarity first, Motion first and Save data.
It reports actual source pixels, presented FPS and received WebSocket payload Mb/s.
These are measured image-stream statistics, not hardware-video claims. Preferences
survive reload; selecting the current mode, changing locale or theme never
reconnects the application.

Stream version 2 explicitly negotiates these modes. The released SDK owns changed
region detection, PNG/WebP/JPEG selection, source references and idle refinement.
Small changes and clarity/data modes preserve exact pixels; automatic/motion may
use JPEG for dense changes, then restore exact still pixels after motion ends.
Unchanged pixels send no image bytes. Save data lowers update cadence. Quality
modes do not change application geometry or invent source detail.

The released browser decoder composites ordered regions against their declared
base frame. At most two current-target frames and one retired decode can be
retained. Only composition grants input authority and sends acknowledgement;
stale decodes cannot paint or acknowledge a new target. An invalid reference or
failed decode requires explicit connection recovery. The product never implements
a second decoder. Existing version-1 sessions keep whole-PNG viewing; their
picture choices are disabled with explicit component-update and app-reopen guidance.
Updating a viewer does not restart the application or replace its bound component.
The [performance guide](../operations/host-application-performance.md) owns workload,
measurement, thresholds and the limits of any responsiveness claim.


## Remote cursor geometry

Published `floe-native-apps` prepares the only Linux cursor owner. Remote PNG
shapes, alpha and complete bounds are retained; their longest edge is at most
24 CSS pixels and smaller images are never enlarged. The hotspot uses the same
scale, is rounded once and remains inside the image. Integral backing density
declared through CSS `image-set()` affects resolution only. DPR and viewport
changes render from the original decoded image, never from an already scaled copy.
CSS cursors and the existing remote pointer use the same normalized result.

One connection owns its current image and decode generation. A newer packet,
reset or disconnect invalidates pending decodes; destroyed windows receive no
late updates, and new windows inherit the current result. Transparent images
remain invisible. Invalid metadata or failed decoding clears the old cursor and
restores the system default without interrupting input. Redeven adds no cursor
size setting, CSS override, mouse listener or second image-processing path.

New sharing connections use current cursor resources while preserving application
identity. macOS native applications retain the client's existing cursor.

# Boundaries

Picture mode changes use the authenticated current attachment. Renderer requests
cannot choose a codec implementation, binary, capture executable or installation.
Current source dimensions are authoritative; image quality does not create extra
pixels or certify hardware video. The native component and browser decoder must
come from the same published SDK contract; no product-local codec or patch parser
is maintained.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/linux.js`: preferences, negotiation, painted-target binding and statistics.
- `internal/hostapps/desktop_transport.go`: authenticated capability forwarding and attachment ownership.
- `internal/codeapp/appserver/host_applications.go`: published decoder resource integration.
- `internal/envapp/ui_src/src/ui/services/linuxHostApplicationViewer.test.ts`: picture changes, legacy sessions, references, reconnect and lifecycle.

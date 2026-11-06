---
type: Product Interaction Contract
title: Browser and desktop settings
tags: [ai, computer-use, settings, desktop, envapp]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Both carriers share Browser and desktop settings. Runtime capabilities, thread grants/selection and extension consent are independent. Open/refresh/close grants or launches nothing; failed reads stay unknown and lost targets unavailable. Floret alone owns conversation lifecycle.

# Contract

## Overview and navigation
The overview identifies the actual Runtime hostname and platform, followed by one grouped settings list for the built-in browser, browser connections, and desktop/applications. Each row places its status next to its action. Conversation target status and return-to-chat prompts are absent from environment settings; manual page/app selection remains an explicit secondary entry. Overview and browser refresh read only the environment; candidates load when opening the selector or access settings. Opening or enabling never downloads.

The browser page presents connected profiles with their actual Chrome/Chromium marks, inline connection status, and a shared connect/refresh action row. Refresh retains the previous observed profiles until the response arrives. Disconnected states expose the connection action, while genuine diagnostics remain visible. Pairing details, permissions explanations and advanced connection controls use secondary disclosure. Both carriers bundle unchanged, hash-pinned theSVG browser and operating-system marks; unknown identities remain generic. Layout uses published Floe surfaces and tokens, reflows at narrow widths, and reserves asynchronous action geometry.

Extension installation presents two compact action rows: open the real browser Extensions page, then reveal the prepared folder in the host file manager. Instructions explicitly place Developer mode and folder dragging in the browser. Settings must not render simulated drop targets, browser switches or draggable folders; decorative brand marks imply no interaction. Paths, alternate installation and longer explanations stay in Help. Opening a page or folder is not installation evidence; only the existing browser handshake can confirm a connection.

Both carriers provide complete explicit localized copy.

## Runtime observation and recovery
`GET computer/environment` returns hostname, platform, managed-browser capability, desktop capability, and the existing live Chrome status snapshot. Capability is an observation, not an authorization or a guarantee that subsequent startup cannot fail.

Published Floe components already supply the required UI primitives, so this change is product integration rather than an upstream platform extension.

Missing Linux desktop components have an explicit **Ask Flower to install** action in diagnostics and the canonical setup question. It creates a separate same-Runtime conversation using the normal durable send contract, with a reference back to the original task. Opening diagnostics, passive refresh and desktop verification never submit the original input or retry its failed action. Repair admission, installation and verification are distinct facts; the executable repair contract is owned by [Linux private desktop](computer-use-desktop.md#linux-private-desktop).

# Boundaries

Inspection never selects a page, grants authority, starts a task or installs components. A lost selection stays unavailable until it is recovered or explicitly replaced; the settings dialog does not own Floret lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/FlowerComputerConnections.tsx` - Source.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx` - Source.

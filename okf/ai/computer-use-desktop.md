---
type: Desktop Integration Contract
title: Semantic desktop operations and explicit control
tags: [ai, computer-use, accessibility, desktop]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

ComputerUseRuntime owns desktop execution: explicit macOS app window or private Linux Xvfb/D-Bus. Semantic actions prefer native accessibility. Foreground work requires task authorization and honors Stop/takeover; OS permissions alone cannot certify unobtrusive background operation.

# Contract

## macOS windows
The Swift helper inventories regular and accessory application windows, reads AX roles, labels, non-sensitive values, supported actions and bounds, and exposes bounded subtree queries.

Application discovery reuses HostApplicationCatalog; exact candidate selection
uses NSWorkspace with current app/foreground permission. Launch completion is
synchronized, cancellation stops further actions, and window readiness is bounded.
Minimized windows are restored once and allowed to settle; zero/multiple windows
return explicit selection facts. No path-supplied shell launcher or independent
application lifecycle is exposed to guest scripts.

Secret fields enter the existing private takeover channel rather than model observations.

Snapshots declare source macos_accessibility and application_provided coverage.
truncated:false means the available tree was not cut, not that all visible content
is present. Use screenshots and targeted scrolling when application AX content
is sparse. No global accessibility opt-in attribute is forced.

## Explicit interaction and effects
The published floe-native-apps v0.26.0 owns pointer events, timed sequences,
window/PID routing and pasteboard primitives. Redeven owns target/process checks,
authorization, cancellation, source serialization and result facts. Directed input
requires a live window route; missing optional WindowServer support fails without
foreground substitution. Receipts count delivered events, not application effects.
Cancellation releases only task-owned transitions at the last posted position.
AX actions retain existing foreground consent because applications may activate.

The script facade exposes hover, left/right/middle and modified clicks, holds,
selection read/text/ranges/all/replacement, discovered AX actions, values and
bounded input sequences. UTF-16 selections reject split surrogates. Browser
counterparts use CDP input, DOM selection or explicitly identified synthetic
control events. Preflight rejects unsupported controls before mutation.

Native key/press and copy/cut/paste select the existing consented foreground route before dispatch: AppKit may receive a background chord without executing its menu action. No automatic foreground retry follows directed input. AX selection ranges have no direction contract; non-none directions fail before mutation. Explicit input preserves modifiers and repeat, and cancellation releases only posted task-owned keys/buttons.

Copy/cut preserve their actual editing semantics; paste is independent of fill.
System clipboard read/write/paste requires Full access plus platform permission.
Typed bytes and formats are explicit. Supplied paste leaves the clipboard when
consumption is unverified; it never restores over a concurrent user copy. Browser
setFiles uses supplied bytes only (16 files, 256 KiB encoded), never arbitrary host
paths. Existing target discovery/selection, downloads and native file dialogs
retain their authorization boundaries. Capabilities describe support conditions;
unsupported application controls fail explicitly.

## Linux private desktop
The Xvfb owner starts a private session D-Bus and AT-SPI bus. The executor rejects socket or environment paths leading outside that private desktop; it never discovers or attaches to another logged-in user's session.

Environment inspection is read-only and reports all missing configured executables and their actual paths. The setup question and Linux diagnostics offer **Ask Flower to install**. A click starts a separate conversation through the current Runtime adapter with the selected model, permission mode and working directory. Flower rechecks the observed host, installs or repairs components through existing general-purpose terminal tools, and verifies X11, private D-Bus, AT-SPI and screenshot readiness. Custom paths require confirmation before changes. No automatic package-manager command is executed by the UI, and captured suggested commands are excluded from the repair prompt. Host observations are bounded JSON explicitly identified as untrusted data.

The repair uses existing approval controls, never requests passwords in chat or tool calls, and reports a blocker if private system authorization is unavailable. Admission is not installation success. The original conversation, draft, references and pending input remain intact; the repair carries a readable thread reference back to the original task. Durable outbox recovery retries the same request identity after an uncertain send. Accepting a repair never binds unrelated drafts, and a delayed receipt does not redirect a user who changed conversations. Interrupted package operations require inspection before another attempt; no failed Computer Use action is replayed.

An explicit RWX-authorized verification serializes with target control, refuses an occupied desktop, and checks X11, private D-Bus, AT-SPI and screenshot capture without changing the conversation target or sending input. Passive refresh never starts the desktop. Previously failed target snapshots become selectable after a fresh successful resource check; selection still performs its normal readiness handshake.

A failed private-desktop readiness check reports that input was not dispatched. Only exact, current canonical evidence in an agent-authored question exposes the setup entry; verification leaves that question unanswered and never replays the failed action. Linux application discovery is not implied by private desktop availability.

Product target preferences and canonical historical results follow their existing owners.

# Boundaries

Swift unit tests and real GTK/AT-SPI/Xvfb fixtures provide separate adapter proofs. Lock-screen operation remains outside the supported scope.

# Evidence

- `redeven:internal/ai/computer_desktop_setup_integration_test.go` proves separate repair admission, a real terminal fixture installation and model-visible verification, request idempotency and preservation of the original canonical wait. Browser tests cover direct and diagnostic actions, failure/retry, read-only mode, source references, retained drafts and delayed admission. The Ubuntu qualification script separately installs and repairs real packages in an isolated private Xvfb/AT-SPI fixture; fixture evidence does not certify installation on a user's host.

- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift` - Source.
- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/ScreenCapture.swift` - Source.

- 2026-11-03 acceptance: 42 Swift tests and the real AppKit fixture pass, including copy/cut/paste effects, source reads, Unicode range checks, hover/input, scroll, privacy pause and conditional focus/pointer restoration. Repeated fixture runs may stop at unavailable input monitoring; qualification never bypasses that boundary.
- Browser acceptance: 259 focused tests pass, plus the five real Chromium interaction/source scenarios, relocated packaged helpers, 16 Desktop bundle tests, the HTTP provider output assertion and Flower UI restart/Stop/unknown-effect checks.
- Upstream v0.26.0 source and macOS CI pass. Release qualification run 41618377322 failed twice during Linux artifact downloads before native qualification. This is not a successful Linux release qualification; advanced interactions here are browser/macOS adapter capabilities.

---
type: Interaction Contract
title: Client input for host applications
description: Own composition once on the client, bind confirmed text and keys to painted application windows, and recover without replay.
tags: [applications, input, linux, macos, desktop]
timestamp: 2026-09-24T19:25:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Published Floe remote-input owns viewer keyboard/composition. Clients own input method/preedit/candidates; hosts deliver confirmed Unicode/keys to the painted window. Each operation has one output owner. Binding loss cancels composition/releases keys; reconnect never replays. Unsupported old protocols require save/quit/reopen without automatic process termination. Flower, terminals and editors keep their own input.

# Contract

- Embed published remote-input/CSS. Each backend has one copy/cut/paste handler, excluding duplicate IME submission. Flush pending pointer output before keys/text/clipboard.
- Native Linux uses authenticated published helper transport without another gesture/composition owner. Browser/OS owns clipboard normalization; confirmed Unicode stays byte-exact.
- Upstream owns retained Xpra capability, private environment, commit-only XIM, toolkit adapters, prepared client and scheduler. Historical preparation version alone cannot reject a viewer, replace modules or kill processes.
- macOS advertises `input_version: 1` and never switches global input source. Same-window recapture may retain focus but rejects input until decoded replacement pixels.

# Boundaries

[Validation](../operations/host-application-input-validation.md) distinguishes simulated events, app receipts, OS IME and physical mobile evidence. Sent packets, emulated viewports and synthetic composition alone do not certify system input acceptance.

# Evidence

- `go.mod` and `internal/envapp/ui_src/package-lock.json`: released upstream versions.

- `internal/hostapps/setup.go` and `linux.go`: capability, launch preparation and surviving-process boundaries.

- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller and CSS embedding.

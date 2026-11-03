---
type: Interaction Contract
title: Client input for host applications
tags: [applications, input, linux, macos, desktop]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floe remote-input owns keyboard/composition; clients own IME/preedit/candidates and hosts deliver confirmed Unicode/keys to painted windows. Each operation has one output owner. Binding loss cancels/releases without replay; old protocols require explicit save/quit/reopen.

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

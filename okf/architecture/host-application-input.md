---
type: Interaction Contract
title: Client input for host applications
description: Own composition once on the client, bind confirmed text and keys to painted application windows, and recover without replay.
tags: [applications, input, linux, macos, desktop]
timestamp: 2026-09-24T19:25:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe remote-input owns keyboard and composition events in every streamed
Host Application viewer. The client chooses its input method, preedit and candidates;
the host delivers confirmed Unicode or key transitions to the current application.
One user operation has one owner and one output. Binding loss cancels composition
and releases held keys; reconnect never replays input. Old input protocols require
saving, quitting and reopening the application, without automatically ending its process.
This contract does not change Flower, terminal widgets or editor input.

# Contract

## Client ownership
Redeven embeds `@floegence/floe-webapp-core/remote-input` and its stylesheet from the published package.

Copy, cut and paste have one handler per backend and cannot also produce an IME submission.

Platform adapters flush pending pointer output before sending keys, text or clipboard actions to preserve input order.

## Linux native delivery
The combined backend consumes the published helper protocol through an authenticated Runtime stream. It never registers another composition or gesture owner.

System clipboard normalization belongs to the browser/OS; confirmed Unicode remains byte-exact.

## Retained Xpra delivery
Released `floe-native-apps` owns the capability probe, private input environment, commit-only xcb-imdkit XIM bridge, GTK3/GTK4/Qt5/Qt6 context adapters, prepared HTML client and authenticated Xpra input scheduler.

Linux never rejects the whole viewer because an application's historical preparation version differs.

No loaded module is replaced and no process is killed.

## macOS delivery
Native window snapshots advertise `input_version: 1`. Production code never switches the host's global input source.

Same-window recapture can retain local focus but rejects input until the replacement frame is decoded.

## Verification boundary
The [validation record](../operations/host-application-input-validation.md) distinguishes controller event simulation, real app text receipts, real OS IME input and actual mobile-device evidence. A sent packet, mobile viewport emulation or synthetic composition event alone does not establish system input-method acceptance.

# Boundaries

Binding loss cancels composition and releases held keys without replay. This input boundary does not change Flower, terminal or editor input.

# Evidence

- `go.mod` and `internal/envapp/ui_src/package-lock.json`: released upstream versions.

- `internal/hostapps/setup.go` and `linux.go`: capability, launch preparation and surviving-process boundaries.

- `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`: published controller and CSS embedding.

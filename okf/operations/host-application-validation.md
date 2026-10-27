---
type: Validation Guide
title: Host application distribution validation
description: Installed-stack evidence, architecture limits and repeatable native application acceptance.
tags: [runtime, applications, linux, validation]
timestamp: 2026-09-24T19:25:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Historical Xpra userspace checks certify only their tested stack, not host policy. Current combined-backend, sandbox and product evidence belongs to desktop/package validation; platform contracts own capability/isolation. Missing subscriptions, CPU translation and untested policy remain explicit. Administrators use the setup route.

# Contract

## Managed component qualification
The published `floe-native-apps` v0.1.2 stack passed real Xpra window discovery, picture decoding, a live private D-Bus connection and button input receipt on Ubuntu 22.04 arm64 and Debian 11 amd64 hosts.

The test reports launch-to-window readiness, then requires another authoritative Xpra window inventory response within three seconds.

This is window integration evidence; the separate managed native launch test establishes actual host application execution.

## Client input qualification
[Host application input validation](host-application-input-validation.md) owns current GTK3/GTK4/Qt/XIM application receipts, click-to-keyboard focus, old-session upgrade checks and the distinction between synthetic composition and real IME acceptance. Earlier component installation results do not qualify toolkit input.

## Mobile pointer acceptance
The September 24 follow-up uses published Floe core `0.77.1` and production viewer assets.

Run `pnpm --dir internal/envapp/ui_src test:host-application-browser` for the bounded three-engine pointer and appearance suite.

The previously separate real OS IME candidate checks remain independent of this pointer task.

## Platform evidence
[Host application platform validation](host-application-platform-validation.md) records the Linux distribution matrix, translation limitations, native macOS acceptance and reproducible platform commands. Component, client-input and pointer qualification do not extend that platform evidence.

# Boundaries

Installed-stack results certify only the tested userspace, Runtime and display combination. Platform-specific limitations remain part of each recorded result.

# Evidence

- [Floe native input v0.5.1 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35834089131): immutable native amd64/arm64 managed/system application input matrix.

- [Floe webapp v0.71.0](https://www.npmjs.com/package/@floegence/floe-webapp-core/v/0.71.0): published remote-input controller, subsequently consumed through 0.72.0.

- `internal/hostapps/setup_test.go`: published component preparation and responsive application window inventory.

---
type: Validation Guide
title: Host application distribution validation
tags: [runtime, applications, linux, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Historical Xpra userspace checks certify only their tested stack, not host policy. Current combined-backend, sandbox and product evidence belongs to desktop/package validation; platform contracts own capability/isolation. Missing subscriptions, CPU translation and untested policy remain explicit. Administrators use the setup route.

# Contract

Published native 0.1.2 qualified real Xpra discovery/decoded pixels/private D-Bus/button receipts on Ubuntu 22.04 arm64 and Debian 11 amd64. Require another authoritative inventory within 3 s after launch readiness. Window integration differs from managed actual application execution.

[Input validation](host-application-input-validation.md) owns GTK3/GTK4/Qt/XIM receipts, focus and old-session upgrades; component installation cannot certify input. September 24 pointer follow-up uses Floe core 0.77.1/product assets; run pnpm --dir internal/envapp/ui_src test:host-application-browser for three-engine pointer/appearance. OS IME candidates remain separate.

[Platform validation](host-application-platform-validation.md) owns distribution/translation/macOS evidence and commands; earlier components/pointers cannot extend it.

# Boundaries

Installed-stack results certify only the tested userspace, Runtime and display combination. Platform-specific limitations remain part of each recorded result.

# Evidence

- [Floe native input v0.5.1 qualification](https://github.com/floegence/floe-native-apps/actions/runs/35834089131): immutable native amd64/arm64 managed/system application input matrix.

- [Floe webapp v0.71.0](https://www.npmjs.com/package/@floegence/floe-webapp-core/v/0.71.0): published remote-input controller, subsequently consumed through 0.72.0.

- `internal/hostapps/setup_test.go`: published component preparation and responsive application window inventory.

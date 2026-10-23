---
type: Desktop Contract
title: Desktop application updates
description: Signed macOS and Linux application updates with an explicitly unsupported internal Windows channel.
tags: [desktop, updates, sparkle, linux, windows, security, release]
timestamp: 2026-08-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven Desktop exposes one update coordinator to the permanent Welcome
titlebar-corner entry, application menu, command palette, settings, status bar,
and compatibility recovery. Packaged macOS uses Sparkle 2.9.4 with a signed
architecture-specific appcast. Packaged Linux uses `electron-updater` metadata
for the matching DEB or RPM package. Development, unsupported, and incorrectly
placed macOS builds fail closed and provide a manual recovery path.
Windows internal NSIS builds report updates as unsupported and contain no
production feed.

# Contract

## Check and presentation
The coordinator owns the states `idle`, `checking`, `available`, `downloading`, `ready`, `installing`, `blocked`, and `error`. A check is serialized; repeated requests reuse the current operation and never start a second download.

The permanent Welcome titlebar entry is a compact icon-only button with no resting border or label. Its localized state remains available through the accessible name and the shared tooltip on hover or keyboard focus. Checking animates the icon unless reduced motion is requested; available and ready updates add a small overlaid dot without changing the button width. Warning states tint the icon, and keyboard focus has a visible outline.

No client request contains a GitHub token or a repository-specific credential.

## Installation interlock
Installation is a one-shot action. A cleanup or identity verification failure prevents the installer call, restores the Launcher, and reports an actionable error.

The first release that contains Sparkle remains a manual install; later signed DMG releases are eligible for the feed.

## Release and trust
Release jobs run in the protected `redeven-release` environment.

The manual exact-main Windows workflow may publish only an Actions artifact whose filename marks it as internal.

# Boundaries

Sparkle owns macOS update discovery, verification, download UI, and relaunch. The release workflow owns credentials and publication; Runtime, Provider, and Gateway services do not own Desktop application updates.

# Evidence

- `redeven:desktop/src/welcome/App.tsx:1` and `redeven:desktop/src/welcome/index.css:1` - Permanent icon entry, localized tooltip, and state presentation.

- `redeven:desktop/src/main/desktopUpdateCoordinator.ts:1` - Unified state machine, concurrency, startup scheduling, and installation interlock.

- `redeven:desktop/src/main/macSparkleUpdateAdapter.ts:1` - Sparkle bridge adapter and native update request boundary.

- `redeven:desktop/src/main/linuxPackageUpdateAdapter.ts:1` - DEB/RPM update metadata, download, cancellation, and install adapter.

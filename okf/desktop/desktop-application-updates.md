---
type: Desktop Contract
title: Desktop application updates
description: One user-facing update coordinator for signed macOS Sparkle feeds and Linux DEB/RPM packages.
tags: [desktop, updates, sparkle, linux, security, release]
timestamp: 2026-08-25T00:00:00Z
---
# Summary

Redeven Desktop exposes one update coordinator to the permanent Welcome
content-header entry, application menu, command palette, settings, status bar,
and compatibility recovery. Packaged macOS uses Sparkle 2.9.4 with a signed
architecture-specific appcast. Packaged Linux uses `electron-updater` metadata
for the matching DEB or RPM package. Development, unsupported, and incorrectly
placed macOS builds fail closed and provide a manual recovery path.

# Contract

## Check and presentation

The coordinator owns the states `idle`, `checking`, `available`, `downloading`,
`ready`, `installing`, `blocked`, and `error`. A check is serialized; repeated
requests reuse the current operation and never start a second download. Startup
checks begin after 30 seconds and are limited to once per 24 hours. Stable
releases are the only automatic or manual feed candidates. The user must open
the native Sparkle window or the Redeven Linux dialog before downloading or
installing an update.

The Welcome content header always shows a labeled check action in its
upper-right action group. Its accessible label reports the current update
state, checking animates the icon, and an available or ready update adds a
visible indicator. The status-bar entry remains a compact secondary route to
the same coordinator.

Automatic checks are persisted only for Linux. macOS scheduling is delegated to
Sparkle with a 24-hour interval and automatic installation disabled. No client
request contains a GitHub token or a repository-specific credential.

## Installation interlock

Installation is a one-shot action. Before the installer is called, Desktop
blocks new Launcher operations, closes Desktop sessions and windows, retires
Desktop transports, and stops only the verified local bundled Runtime. External
Provider and Gateway processes are outside this cleanup boundary. A cleanup or
identity verification failure prevents the installer call, restores the
Launcher, and reports an actionable error.

macOS updates are enabled only when the app bundle is inside `/Applications`.
The blocked state offers Finder reveal and the Applications folder action. The
first release that contains Sparkle remains a manual install; later signed DMG
releases are eligible for the feed.

## Release and trust

Release jobs run in the protected `redeven-release` environment. Apple
Developer ID signing and notarization inputs, the Sparkle Ed25519 private key,
public key, Team ID, and API credentials are environment secrets only. CI
validates the Sparkle keypair, writes temporary key material with restrictive
permissions, and removes it after signing. Source and logs contain no account
identifiers, keychain names, private keys, or reference-product identity.

Stable tags produce signed x64 and arm64 appcasts, signed release notes, and
notarized/stapled DMGs. Prerelease tags produce no Sparkle feed. The release
collector requires the exact stable inventory, and appcasts, notes, Linux
metadata, and installers are included in `SHA256SUMS`, the Cosign signature,
remote readback, and byte-level comparison.

# Boundaries

Sparkle owns macOS update discovery, verification, download UI, and relaunch.
`electron-updater` owns Linux package metadata, download progress, cancellation,
and installation. Desktop owns policy, state mapping, cleanup, and renderer
entry points. The release workflow owns credentials and publication; Runtime,
Provider, and Gateway services do not own Desktop application updates.

# Evidence

- `redeven:desktop/src/main/desktopUpdateCoordinator.ts:1` - Unified state machine, concurrency, startup scheduling, and installation interlock.
- `redeven:desktop/src/main/macSparkleUpdateAdapter.ts:1` - Sparkle bridge adapter and native update request boundary.
- `redeven:desktop/src/main/linuxPackageUpdateAdapter.ts:1` - DEB/RPM update metadata, download, cancellation, and install adapter.
- `redeven:desktop/src/main/main.ts:3621` - Packaged-platform selection, `/Applications` gate, cleanup, and renderer broadcast.
- `redeven:desktop/electron-builder.config.mjs:105` - Credential-free feed URL and Sparkle security configuration injected at package time.
- `redeven:scripts/generate_desktop_sparkle_appcast.sh:1` - Stable appcast generation, signature verification, and temporary key cleanup.
- `redeven:.github/workflows/release.yml:404` - Protected Sparkle appcast job and release artifact publication.

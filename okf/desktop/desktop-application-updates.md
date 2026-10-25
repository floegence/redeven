---
type: Desktop Contract
title: Desktop application updates
description: Signed macOS and Linux application updates with an explicitly unsupported internal Windows channel.
tags: [desktop, updates, sparkle, linux, windows, security, release]
timestamp: 2026-08-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One Desktop update coordinator serves Welcome, menus, command palette, settings, status and compatibility recovery. Packaged macOS uses signed architecture-specific Sparkle appcasts; Linux uses matching DEB/RPM metadata through `electron-updater`. Development, unsupported and misplaced macOS builds fail closed with manual recovery. Internal Windows NSIS builds expose no production feed and report updates unsupported.

# Contract

- Serialize `idle`, `checking`, `available`, `downloading`, `ready`, `installing`, `blocked` and `error` transitions. Repeated checks reuse the operation; never start a second download.
- Welcome has a permanent compact icon button, localized accessible name/tooltip, visible keyboard focus, reduced-motion-aware checking animation, fixed-width availability dot and warning tint.
- Installation is one-shot. Failed cleanup or identity checks prevent installer invocation, restore Launcher and report recovery. The first Sparkle-enabled release needs manual installation; later signed DMGs can use its feed.
- Protected `redeven-release` jobs own credentials/publication. Clients contain no GitHub credentials. Manual exact-main Windows builds publish only explicitly internal Actions artifacts.

# Boundaries

Sparkle owns macOS discovery, verification, download UI and relaunch. Runtime, Provider and Gateway never own Desktop updates. Exact bundled versions belong to dependency manifests.

# Evidence

- `redeven:desktop/src/welcome/App.tsx:1` and `redeven:desktop/src/welcome/index.css:1` - Permanent icon entry, localized tooltip, and state presentation.

- `redeven:desktop/src/main/desktopUpdateCoordinator.ts:1` - Unified state machine, concurrency, startup scheduling, and installation interlock.

- `redeven:desktop/src/main/macSparkleUpdateAdapter.ts:1` - Sparkle bridge adapter and native update request boundary.

- `redeven:desktop/src/main/linuxPackageUpdateAdapter.ts:1` - DEB/RPM update metadata, download, cancellation, and install adapter.

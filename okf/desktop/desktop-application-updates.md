---
type: Desktop Contract
title: Desktop application updates
tags: [desktop, updates, sparkle, linux, windows, security, release]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

One Desktop update coordinator serves every entry. Packaged macOS uses signed architecture-specific Sparkle; Linux uses matching DEB/RPM feeds. Unsupported, development or misplaced builds offer manual recovery. Internal Windows NSIS has no production update feed.

# Contract

- Serialize `idle`, `checking`, `available`, `downloading`, `ready`, `installing`, `blocked` and `error` transitions. Repeated checks reuse the operation; never start a second download.
- Welcome has a permanent compact icon button, localized accessible name/tooltip, visible keyboard focus, reduced-motion-aware checking animation, fixed-width availability dot and warning tint.
- Installation is one-shot. Failed cleanup or identity checks prevent installer invocation, restore Launcher and report recovery. The first Sparkle-enabled release needs manual installation; later signed DMGs can use its feed.
- Protected `redeven-release` jobs own credentials/publication. Clients contain no GitHub credentials. Manual exact-main Windows builds publish only explicitly internal Actions artifacts.

# Boundaries

Sparkle owns macOS discovery, verification, download UI and relaunch. Runtime, Provider and Gateway never own Desktop updates. Exact bundled versions belong to dependency manifests.

# Evidence

- `redeven:desktop/src/welcome/App.tsx:1` and `redeven:desktop/src/welcome/index.css:1`
- `redeven:desktop/src/main/linuxPackageUpdateAdapter.ts:1` - Source.

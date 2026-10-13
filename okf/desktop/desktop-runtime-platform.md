---
type: Desktop Contract
title: Runtime platform facts and icons
description: Identify the actual Runtime OS from trusted observations and display local platform marks without changing card continuity.
tags: [desktop, runtime, platform, accessibility]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Redeven Runtime owns its OS and Linux distribution facts; Desktop consumes only recognized trusted platform observations. Environment titles display pinned local theSVG marks for macOS, Linux or Windows in their original brand colors with localized accessible names. Last known facts survive disconnect, failed probes and Desktop restart until a new online Runtime observation updates them. Unknown platforms display a default device illustration and do not block an otherwise supported Runtime. Snapshots preserve the card, access perspective, focus and geometry; provider or client identity never substitutes for the Runtime OS.

# Contract

## Optional Runtime platform fact

Redeven Runtime owns `runtime_platform` and optional `runtime_linux_distribution` in the private startup/attach report, local health response, management-socket status and placement bridge hello. It derives the OS from its own Go runtime. On Linux, the released `github.com/acobaugh/osrelease` reader obtains the Runtime userspace’s `ID` from `/etc/os-release`, falling back to `/usr/lib/os-release`. A container reports its own userspace and WSL reports its actual Linux installation. `ID_LIKE`, `NAME`, Desktop identity, editable WSL registration names and container image names cannot supply distribution identity. Missing, unreadable or malformed release information yields no distribution. These additive display facts grant no capability and do not change compatibility admission. ReDevPlugin is a separately released plugin execution dependency and does not generate these Redeven Desktop reports.

Desktop normalizes recognized OS strings to `macos`, `linux` or `windows` at report boundaries and discards unknown values without guessing. Startup, current-runtime state, health and Presence retain this optional fact; absence in an older otherwise supported Runtime does not fail connection or health checks. Cloud health may carry the same optional fact but Cloud identity and URLs cannot infer it.

Distribution IDs are lowercase, bounded to 64 characters and contain only letters, digits, dots, underscores or hyphens. Desktop accepts them only alongside a Linux OS observation. The UI maps exact IDs to the reviewed local brand catalog: Ubuntu, Debian, Fedora, Arch Linux, Alpine Linux, CentOS, AlmaLinux, Rocky Linux, Red Hat Enterprise Linux, Linux Mint, Manjaro, NixOS, openSUSE, SUSE Linux Enterprise, Kali Linux, Gentoo, Pop!_OS and Raspberry Pi OS. Explicit openSUSE Leap/Tumbleweed and SUSE Linux Enterprise Desktop IDs share their distribution brand. An unknown derivative never borrows its `ID_LIKE` parent’s mark; absent or unsupported IDs use colored Tux.

## Remembered display facts

Desktop main owns one durable `runtime_platform_facts` map in its existing UI state store, keyed by environment kind and stable identity. Saved URL entries include their registered URL so editing the address does not reuse another Runtime’s fact. Renderer storage cannot set this map. Every Welcome snapshot records recognized Runtime observations and projects the last known OS and distribution when current reports are missing, transport is disconnected or a probe fails. Desktop restart retains the same icons. A new online Runtime OS or distribution observation updates the remembered fact; an older disconnected Gateway catalog cannot replace its member’s last direct observation; changing to a non-Linux OS removes the Linux distribution. An older Linux report with no distribution retains a previously recognized distribution until a newer positive observation changes it. Missing facts never erase remembered facts, and an environment that has never been observed retains its default icon. Remembered facts affect presentation only: health, connection state, compatibility, access and lifecycle authority keep their current owners.

## Display and bundled assets

The title reserves a 1rem non-shrinking slot immediately before the selectable, single-line truncated Runtime name. A .875rem image preserves the original brand colors and scales with text; masks, tinting and grayscale filters must not replace those colors. Apple uses the upstream black mark in light themes and white mark in dark themes, selected from Floe's resolved application theme. Linux retains the colored Tux and Windows retains its blue mark. Its center follows the title font's capital height and baseline rather than the surrounding line box. Known platforms expose a localized Runtime operating-system name to assistive technology and on hover. An unknown platform displays the default device illustration with localized copy stating that the Runtime operating system is unknown; it implies no OS, virtualization technology or cloud provider. Platform and theme changes update the retained image/title/card subtree without changing height, selected access perspective or keyboard focus. Images cannot be dragged, and environment names remain selectable.

Native Local uses `platform_capabilities.platform`; WSL always uses Linux. SSH, container and external URL entries use normalized `runtime_platform` from actual Runtime startup, health or Presence observations. Gateway entries use the member Runtime's `metadata.os`. Cloud entries display only an OS supplied by Runtime health. Desktop host, provider origin, region, hostname and CPU architecture cannot supply a remote Runtime OS. The title follows the primary Runtime across linked access perspectives.

The same observations carry the optional distribution through health, Presence and the Environment entry. Gateway v5 catalogs do not publish a distribution; an opened member’s own Runtime startup/health report can supply it for that exact Gateway member without changing catalog identity or access authority. Unopened members retain Tux until a trusted distribution observation exists. Cloud consumes the optional field only when Runtime health supplies it. Existing Runtime reports with no distribution remain openable.

Apple `light.svg` and `dark.svg`, Linux and distribution `default.svg` files, Windows `default.svg` and the Azure collection’s Virtual Machine `default.svg` are bundled unchanged from `glincker/thesvg` commit `8731f4b62fea303b022e4aa0125783aeb42c3ea5`. Native images preserve original colors without changing source bytes or fetching a CDN. `assets/environment_platform_icons.json` binds source paths, revision, theme variants, licenses and SHA-256. The notice generator verifies and reproduces CC0-1.0, MIT, applicable CC-BY-SA versions and Fedora’s custom trademark guidelines, links original brand sources and records attribution. Brand and distribution names remain literal; surrounding accessible copy is localized.

# Boundaries

[Runtime readiness](desktop-runtime-readiness.md) owns connection and compatibility admission. [Environment card presentation](desktop-environment-card-presentation.md) owns access perspectives and interaction continuity. This concept owns only OS and distribution facts and their marks; platform information grants no lifecycle, access or plugin capability.

# Evidence

- `redeven:spec/openapi/rcpp-v4.yaml` - Optional Runtime OS in the Cloud health schema.
- `redeven:internal/runtimemanagement/runtime_platform_test.go` - Exact distribution identity, missing facts, shell literals and non-Linux boundaries.
- `redeven:internal/localui/localui.go` - Runtime-owned OS in live health and management attach status.
- `redeven:cmd/redeven/desktop_startup_coordination.go` - Preserve the actual observed OS in attached launch reports.
- `redeven:cmd/redeven/desktop_bridge.go` - Carry the observed Runtime platform through the placement hello.
- `redeven:desktop/src/shared/desktopRuntimePlatform.ts` - Closed normalization for optional reports.
- `redeven:desktop/src/main/desktopRuntimePlatformFacts.test.ts` - Disconnect/restart retention, changed system observations and identity isolation.
- `redeven:desktop/src/main/desktopRuntimePlatformProjection.test.ts` - Native, WSL, SSH, container, URL and Cloud source selection, including absent reports.
- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Original brand colors, application-theme Apple variants and a fixed title slot.
- `redeven:desktop/scripts/check-environment-platform-icons.mjs` - All-locale theme, narrow/enlarged-text, local asset loading and live refresh continuity.
- `redeven:scripts/environment_platform_icon_integrity.mjs` - Pinned source, asset SHA-256 and per-asset license validation.

---
type: Desktop Contract
title: Runtime platform facts and icons
description: Identify the actual Runtime OS from trusted observations and display local platform marks without changing card continuity.
tags: [desktop, runtime, platform, accessibility]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Redeven Runtime owns its OS fact; Desktop consumes only recognized trusted platform observations. Environment titles display pinned local theSVG marks for macOS, Linux or Windows in their original brand colors with localized accessible names. Unknown platforms display a default device illustration and do not block an otherwise supported Runtime. Snapshots preserve the card, access perspective, focus and geometry; provider or client identity never substitutes for the Runtime OS.

# Contract

## Optional Runtime platform fact

Redeven Runtime owns `runtime_platform` in the private startup/attach report, local health response, management-socket status and placement bridge hello. It derives the value from its own Go runtime OS (`darwin` becomes `macos`; `linux` and `windows` remain canonical). This additive field grants no capability and does not change compatibility admission. ReDevPlugin is a separately released plugin execution dependency and does not generate these Redeven Desktop reports.

Desktop normalizes recognized OS strings to `macos`, `linux` or `windows` at report boundaries and discards unknown values without guessing. Startup, current-runtime state, health and Presence retain this optional fact; absence in an older otherwise supported Runtime does not fail connection or health checks. Cloud health may carry the same optional fact but Cloud identity and URLs cannot infer it.

## Display and bundled assets

The title reserves a 1rem non-shrinking slot immediately before the selectable, single-line truncated Runtime name. A .875rem image preserves the original brand colors and scales with text; masks, tinting and grayscale filters must not replace those colors. Apple uses the upstream black mark in light themes and white mark in dark themes, selected from Floe's resolved application theme. Linux retains the colored Tux and Windows retains its blue mark. Its center follows the title font's capital height and baseline rather than the surrounding line box. Known platforms expose a localized Runtime operating-system name to assistive technology and on hover. An unknown platform displays the default device illustration with localized copy stating that the Runtime operating system is unknown; it implies no OS, virtualization technology or cloud provider. Platform and theme changes update the retained image/title/card subtree without changing height, selected access perspective or keyboard focus. Images cannot be dragged, and environment names remain selectable.

Native Local uses `platform_capabilities.platform`; WSL always uses Linux. SSH, container and external URL entries use normalized `runtime_platform` from actual Runtime startup, health or Presence observations. Gateway entries use the member Runtime's `metadata.os`. Cloud entries display only an OS supplied by Runtime health. Desktop host, provider origin, region, hostname and CPU architecture cannot supply a remote Runtime OS. The title follows the primary Runtime across linked access perspectives.

Apple `light.svg` and `dark.svg`, Linux `default.svg`, Windows `default.svg` and the Azure collection's Virtual Machine `default.svg` are bundled unchanged from `glincker/thesvg` commit `8731f4b62fea303b022e4aa0125783aeb42c3ea5`. Native image rendering preserves their original colors without altering source bytes or fetching a CDN. `assets/environment_platform_icons.json` binds each source path, revision, theme variant, license and SHA-256. The notice generator verifies the assets and CC0-1.0/MIT texts, reproduces those licenses and records trademark ownership. `macOS`, `Linux` and `Windows` are fixed operating-system names; surrounding accessible copy is localized.

# Boundaries

[Runtime readiness](desktop-runtime-readiness.md) owns connection and compatibility admission. [Environment card presentation](desktop-environment-card-presentation.md) owns access perspectives and interaction continuity. This concept owns only OS facts and their marks; platform information grants no lifecycle, access or plugin capability.

# Evidence

- `redeven:spec/openapi/rcpp-v4.yaml` - Optional Runtime OS in the Cloud health schema.

- `redeven:internal/localui/localui.go` - Runtime-owned OS in live health and management attach status.
- `redeven:cmd/redeven/desktop_startup_coordination.go` - Preserve the actual observed OS in attached launch reports.
- `redeven:cmd/redeven/desktop_bridge.go` - Carry the observed Runtime platform through the placement hello.
- `redeven:desktop/src/shared/desktopRuntimePlatform.ts` - Closed normalization for optional reports.
- `redeven:desktop/src/main/desktopRuntimePlatformProjection.test.ts` - Native, WSL, SSH, container, URL and Cloud source selection, including absent reports.
- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Original brand colors, application-theme Apple variants and a fixed title slot.
- `redeven:desktop/scripts/check-environment-platform-icons.mjs` - All-locale theme, narrow/enlarged-text, local asset loading and live refresh continuity.
- `redeven:scripts/environment_platform_icon_integrity.mjs` - Pinned source, asset SHA-256 and per-asset license validation.

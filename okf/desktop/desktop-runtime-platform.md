---
type: Desktop Contract
title: Runtime platform facts and icons
description: Identify the actual Runtime OS from trusted observations and display local platform marks without changing card continuity.
tags: [desktop, runtime, platform, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven Runtime owns its OS and Linux distribution facts; Desktop consumes only recognized trusted platform observations. Environment titles display pinned local theSVG marks for macOS, Linux or Windows in their original brand colors with localized accessible names. Last known facts survive disconnect, failed probes and Desktop restart until a new online Runtime observation updates them. Unknown platforms display a default device illustration and do not block an otherwise supported Runtime. Snapshots preserve the card, access perspective, focus and geometry; provider or client identity never substitutes for the Runtime OS.

# Contract

## Optional Runtime platform fact
Redeven Runtime owns `runtime_platform` and optional `runtime_linux_distribution` in the private startup/attach report, local health response, management-socket status and placement bridge hello. `ID_LIKE`, `NAME`, Desktop identity, editable WSL registration names and container image names cannot supply distribution identity.

An unknown derivative never borrows its `ID_LIKE` parent’s mark; absent or unsupported IDs use colored Tux.

## Remembered display facts
Desktop main owns one durable `runtime_platform_facts` map in its existing UI state store, keyed by environment kind and stable identity. Renderer storage cannot set this map. Remembered facts affect presentation only: health, connection state, compatibility, access and lifecycle authority keep their current owners.

## Display and bundled assets
The title reserves a 1rem non-shrinking slot immediately before the selectable, single-line truncated Runtime name. A .875rem image preserves the original brand colors and scales with text; masks, tinting and grayscale filters must not replace those colors.

Brand and distribution names remain literal; surrounding accessible copy is localized.

# Boundaries

[Runtime readiness](desktop-runtime-readiness.md) owns connection and compatibility admission. This concept owns only OS and distribution facts and their marks; platform information grants no lifecycle, access or plugin capability.

# Evidence

- `redeven:spec/openapi/rcpp-v5.yaml` - Optional Runtime OS in the Cloud health schema.

- `redeven:internal/runtimemanagement/runtime_platform_test.go` - Exact distribution identity, missing facts, shell literals and non-Linux boundaries.

- `redeven:internal/localui/localui.go` - Runtime-owned OS in live health and management attach status.

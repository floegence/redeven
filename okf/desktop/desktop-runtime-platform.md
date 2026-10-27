---
type: Desktop Contract
title: Runtime platform facts and icons
description: Identify the actual Runtime OS from trusted observations and display local platform marks without changing card continuity.
tags: [desktop, runtime, platform, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Runtime owns OS/distribution facts; Desktop consumes recognized trusted observations and displays bundled original-color marks with localized names. Last-known facts survive disconnect, failed probes and restart until replaced online. Unknown platforms show a device mark without blocking supported Runtime. Display retains card geometry, selection and focus; client/provider identity never substitutes for Runtime OS.

# Contract

- `runtime_platform` and optional `runtime_linux_distribution` come from Runtime startup/attach, health, management status and bridge hello. Only exact distribution ID selects its mark; `ID_LIKE`, names, Desktop identity, WSL labels and image names cannot. Unknown Linux uses Tux.
- Main persists `runtime_platform_facts` in existing UI state, keyed by environment kind/stable identity. Renderer storage cannot write it or turn remembered facts into health/access authority.
- Reserve a nonshrinking 1rem title slot with a .875rem original-color mark and single-line truncated name. No mask, tint or grayscale; localize surrounding accessibility copy, not brand names.

# Boundaries

[Readiness](desktop-runtime-readiness.md) owns admission. Platform display grants no access, lifecycle or plugin capability.

# Evidence

- `redeven:spec/openapi/rcpp-v5.yaml` - Optional Runtime OS in the Cloud health schema.

- `redeven:internal/runtimemanagement/runtime_platform_test.go` - Exact distribution identity, missing facts, shell literals and non-Linux boundaries.

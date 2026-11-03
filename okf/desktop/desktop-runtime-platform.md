---
type: Desktop Contract
title: Runtime platform facts and icons
tags: [desktop, runtime, platform, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime owns OS facts; Desktop renders trusted known values with bundled marks/localized names. Last-known facts survive disconnect/restart until replaced. Unknown OS uses a device mark without blocking Runtime; updates preserve geometry/focus and never infer OS from client identity.

# Contract

- `runtime_platform` and optional `runtime_linux_distribution` come from Runtime startup/attach, health, management status and bridge hello. Only exact distribution ID selects its mark; `ID_LIKE`, names, Desktop identity, WSL labels and image names cannot. Unknown Linux uses Tux.
- Main persists `runtime_platform_facts` in existing UI state, keyed by environment kind/stable identity. Renderer storage cannot write it or turn remembered facts into health/access authority.
- Reserve a nonshrinking 1rem title slot with a .875rem original-color mark and single-line truncated name. No mask, tint or grayscale; localize surrounding accessibility copy, not brand names.

# Boundaries

[Readiness](desktop-runtime-readiness.md) owns admission. Platform display grants no access, lifecycle or plugin capability.

# Evidence

- `redeven:spec/openapi/rcpp-v5.yaml` - Source.
- `redeven:internal/runtimemanagement/runtime_platform_test.go` - Tests.

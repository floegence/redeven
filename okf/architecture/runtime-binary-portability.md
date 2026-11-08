---
type: Build Contract
title: Portable native Runtime binaries
tags: [runtime, build, release, linux]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Shared builder owns Runtime/Gateway terminal linkage: Linux runs on glibc/musl without host loader; Darwin requires matching Apple build. Every shipped Redeven Runtime enables terminal-go's `floeterm_native` build tag with cgo. Cross builds select the explicit `<arch>-linux-gnu` or `<arch>-unknown-linux-gnu` compiler pair; preflight fails before source copying or asset generation when the compiler or static libraries are missing.

# Contract

Redistributors must retain equivalent access to the matching source and kit.

# Boundaries

Missing native build tools fail preflight. A missing kit blocks publication; a Darwin artifact still requires the matching Apple builder.

# Evidence

- `scripts/build_runtime_binary.sh` and its tests: target selection, static preflight and build flags.

- `scripts/collect_runtime_relink.py` and its tests: relocatable object and native archive capture.

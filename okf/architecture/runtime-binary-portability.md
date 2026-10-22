---
type: Build Contract
title: Portable native Runtime binaries
description: GNU static Runtime builds, native Floeterm, musl execution and LGPL source/relink distribution.
tags: [runtime, build, release, linux]
timestamp: 2026-09-20T10:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The shared Runtime builder owns native terminal linkage for Runtime and Gateway.
Linux artifacts run on glibc and musl systems without a host dynamic loader;
Darwin artifacts require a matching Apple builder. Missing native tools fail
preflight. Linux releases must include matching source and relink materials for
the statically linked LGPL library, and publication fails when that kit is absent.

# Contract

Every shipped Redeven Runtime enables terminal-go's `floeterm_native` build tag with cgo. Cross builds select the explicit `<arch>-linux-gnu` or `<arch>-unknown-linux-gnu` compiler pair; preflight fails before source copying or asset generation when the compiler or static libraries are missing.

Redistributors must retain equivalent access to the matching source and kit.

# Boundaries

Missing native build tools fail preflight. A missing kit blocks publication; a Darwin artifact still requires the matching Apple builder.

# Evidence

- `scripts/build_runtime_binary.sh` and its tests: target selection, static preflight and build flags.

- `scripts/collect_runtime_relink.py` and its tests: relocatable object and native archive capture.

- `scripts/package_linux_relink.sh`: exact installed glibc source, copyright and relink instructions.

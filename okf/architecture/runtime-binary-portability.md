---
type: Build Contract
title: Portable native Runtime binaries
description: GNU static Runtime builds, native Floeterm, musl execution and LGPL source/relink distribution.
tags: [runtime, build, release, linux]
timestamp: 2026-09-20T10:00:00Z
---
# Summary

The shared Runtime builder owns native terminal linkage for Runtime and Gateway.
Linux artifacts run on glibc and musl systems without a host dynamic loader;
Darwin artifacts require a matching Apple builder. Missing native tools fail
preflight. Linux releases must include matching source and relink materials for
the statically linked LGPL library, and publication fails when that kit is absent.

# Contract

Every shipped Redeven Runtime enables terminal-go's `floeterm_native` build tag
with cgo. The published module carries the target-specific Ghostty static
archive, generated adapter, public headers, and provenance for Darwin and Linux
on amd64 and arm64. Release builds run on a matching native runner for each
target. One shared Runtime binary builder owns release, Desktop bundle, and SSH
source build commands. Linux builds use the matching GNU C/C++ toolchain, static
linkage, and Go's `netgo,osusergo` implementations while retaining cgo and the
published native Floeterm archive. They run on glibc and musl hosts without an
external ELF interpreter or shared C library. The release gate checks both Runtime
and Gateway ELF files for an interpreter and shared-library dependencies. Darwin
uses the matching native Apple toolchain. Cross builds select the explicit
`<arch>-linux-gnu` or `<arch>-unknown-linux-gnu` compiler pair; preflight fails before
source copying or asset generation when the compiler or static libraries are
missing. Go workspaces remain disabled. Go's DNS resolver reads host resolver
configuration; user lookups use local account files rather than dynamically loaded
NSS modules. Desktop source builds and the exact-main semantic carrier retain the
same native terminal engine contract. Terminal-go's no-tag engine is retained only
as a fail-closed boundary test and is never a shippable Runtime fallback.

Linux release builds retain the complete Go/C link objects and published native
archives. The same release must distribute `redeven_relink_linux_<arch>.tar.gz`
with the exact installed GNU libc source package, downstream patches, copyright
notices, compiler identity, and a relocatable relink command. This is the reviewed
LGPL system-library distribution route; GCC runtime libraries retain their runtime
exception and all texts appear in the root third-party notice. The collector
requires the kit for both Linux architectures, and the release runner relinks and
checks Runtime/Gateway version identity before publication. Go's post-link build
ID can differ, so binary byte identity is not the acceptance criterion. Users may
replace the C library and run the resulting local executable without a signing
key. Redistributors must retain equivalent access to the matching source and kit.

# Evidence

- `scripts/build_runtime_binary.sh` and its tests: target selection, static preflight and build flags.
- `scripts/collect_runtime_relink.py` and its tests: relocatable object and native archive capture.
- `scripts/package_linux_relink.sh`: exact installed glibc source, copyright and relink instructions.
- `scripts/collect_release_artifacts.mjs` and its tests: mandatory Linux source/relink artifact inventory.
- `.github/workflows/release.yml`: ELF dependency check, native relink verification and publication.
- `scripts/generate_third_party_notices.mjs`: verified LGPL and GCC exception license texts.

---
type: Release Contract
title: ReDevPlugin release artifact gate
tags: [release, redevplugin, artifacts, signing]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Consume the coordinated published ReDevPlugin release with artifacts bound to tag, source, target, digest, signer and receipt. Exactly one platform-release-manifest.json binds tag/source/workflow/attestation. Independently verify Go proxy/SumDB h1/go.mod, two npm SHA512/provenance, runtime/worker crates checksums/Cargo VCS, manifest version/closed coordinate order/contract-set hash.

# Contract

## Publication
Use go.mod/Env lock coordinated version. Boundary scan rejects sibling/Go workspace/replace/npm links/copied runtimes-contracts/Rust paths/duplicate platform-core, excluding generated/dependency output and failing on scan errors. No committed plugin package/parallel catalog. Validated latest-only market chooses immutable transport; platform verifies, metadata grants no trust.

Extra/partial/local/mutable/mismatched publication fails before construction.

Manifest uses verified HTTPS/redirects: initial+three network retries including handshake;15s connect/60s transfer/120s retry-start (last transfer may finish later). Exhaustion deletes partials and stops before Rust with release-specific error. Validation never retries. --manifest-file validates identically offline. Node CLI emits validation evidence on canonical/symlink paths; empty success invalid.

## Native artifacts
Build Linux/Darwin amd64/arm64 from exact published crate/packaged lock/Rust1.98.0; no alternative first-party paths. Check target/tools first. Warm caches avoid servers. Transient install retry default3/max5; integrity/signature/manifest stop. REDEVEN_RUSTUP_OFFLINE=1 restricts Rustup cache, not manifest/Cargo validation. Honor Cargo/Rustup/proxies; no probe auto-install/TLS weakening. Recheck installs, preserve exact Cargo. Download120s/backoff2,4s cap60s; cancel stops/cleans diagnostics.

Linux static PIE has no interpreter/dynamic deps. Darwin exact native64-bit Mach-O receives Developer ID/hardening/timestamp before evidence; dev ad-hoc. The runtime alone carries exactly com.apple.security.cs.allow-unsigned-executable-memory=true for Wasmtime executable pages. Keep hardened runtime and library validation; do not grant the exception to Desktop shell or plugin documents. Staging and macOS consumption verify the signed entitlement dictionary and hardened flag, not just the source plist. Development Cargo cache identity includes signing profile and verifier bytes. Emit binary/SPDX/resolved provenance/notices/signature/certificate. Release Sigstore binds tag workflow; ephemeral Ed25519 fails --require-release. Cosign3 flags --new-bundle-format=false/--use-signing-config=false retain workflow/OIDC/transparency checks.

redeven.redevplugin_runtime_build.v1 binds publication/product files/target/tools/source/workflow/signer. Consumption rechecks descriptor/target/profile/signature. Startup uses expected marker digest, never self-hashed trust. Runtime archive exactly Redeven/ReDevPlugin runtime/six evidence files/license/notices.

## Desktop/collector
Before .bundle/<target> replacement validate name/closed flat inventory/Go target/native policy. Gateway separate; full evidence beside Redeven. macOS exclusion matches only independently signed runtime; preserve its bytes/evidence while Redeven/Computer/Sparkle/bridge remain signable. After Electron assembly copy full Computer resources/licenses. Validate startup before signing and after refreshing only signer-visited Runtime/Computer descriptors, just before outer seal.

Inspect final DEB/RPM/read-only DMG; emit v2 installer-bound runtime/six-file receipts. Upload installers/receipts/latest-linux*.yml only. Apple tools/system text suffice without rg; consume full pipefail pipelines. Require Team/signature/hardening/updater key/staple/distribution; Sparkle lipo places binary before -verify_arch. Linux relink source/object archives separate. Derive epoch/windows from reviewed contract, normalize feeds before signed inventory.

DEB: POSIX ustar/GNU regular files/directories,bounded long names,metadata-only root. RPM disables build-id symlinks. Bounded no-follow snapshots reject noncanonical/duplicate paths, links/devices,privileged modes,sparse/PAX,malformed trailers/trailing bytes/oversize.

Collector requires four Runtime/Gateway,four Desktop,two Center directories. Exact inventory:four Redeven/four Gateway archives,two DEBs/two RPMs/two DMGs,six receipts/identical shared metadata and two Center archives/receipts per [CI](ci-and-release-gates.md). Open once no-follow,hash/copy same descriptor,check inode/metadata,fsync/link without replacement; delete partial output on failure.

Internal Windows managed_wsl_archive binds one Linux amd64 archive to version/source/size/digest and rejects redeven.exe. Formal collector rejects all Windows until signing/update certification, never optional fifth target.

Final release requires release-only consumption,signed checksums/safe_extract_tar.py,complete draft name/size/hash readback before publish. [Installer](self-contained-installer.md) owns verify-before-run/immutable activation/retention.

# Boundaries

[CI](ci-and-release-gates.md) owns scheduling/exact-tip; [integration](plugin-integration-gates.md) Host/market/UI. Local/unreleased/mutable/partial/Windows bytes establish no provenance. Packages prove neither execution nor physical-host acceptance.

# Evidence

- redeven:scripts/check_redevplugin_release_artifacts.sh
- redeven:scripts/stage_redevplugin_release_artifacts.sh

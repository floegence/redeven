---
type: Release Contract
title: ReDevPlugin release artifact gate
tags: [release, redevplugin, artifacts, signing]
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Admit only the coordinated published ReDevPlugin release, binding artifacts to tag/source/target/digest/signer/receipt through registry readbacks, native evidence and closed inventory. Partial, mutable, Windows or target-mismatched inputs fail closed.

# Contract

## Published source and trust

Consume manifest-pinned v3.0.37. Boundary scans reject sibling wiring, Go workspace/replace, npm links, copied runtimes/contracts, Rust paths and duplicate platform-core; exclude generated output/dependencies and fail on scanner errors. Do not commit plugin packages/parallel catalog. Validated latest-only market snapshots choose immutable transport; ReDevPlugin verifies retrieval. Metadata is not trust.

Require exactly one upstream platform-release-manifest.json. Bind tag/source/workflow/attestation; independently verify Go proxy/SumDB h1/go.mod, both npm SHA-512 integrities/provenance, runtime/worker crates.io checksums/Cargo VCS, manifest version/closed coordinate order/contract-set hash. Extra assets/partial publication/local or mutable identities/registry mismatches fail before construction.

Manifest transport requires verified HTTPS through redirects. Initial attempt plus three network retries (including handshake):15s connect/60s transfer/120s retry-start bounds; last transfer may finish later. Exhaustion removes partials and stops before Rust preparation with release-specific diagnostics. Validation never retries. --manifest-file applies identical offline validation. Node CLI must validate/emit evidence from canonical or symlinked paths; empty success is not evidence.

## Native construction and admission

Build Linux/Darwin amd64/arm64 from exact published crate/packaged lock/Rust1.88.0; metadata cannot resolve another first-party path. Verify toolchain/target before preparation; warm caches avoid servers. Retry only transient installation failures, three attempts default/five maximum; integrity/signature/manifest failures stop. REDEVEN_RUSTUP_OFFLINE=1 means cache-only Rustup, not manifest/Cargo bypass. Honor standard Cargo/Rustup/proxies, disable probe auto-install, retain TLS/recheck installs/return exact Cargo. Download120s; waits2/4s capped60s; cancellation ends retries/cleans diagnostics.

Linux: static PIE, no interpreter/dynamic dependencies. Darwin: native target-exact64-bit Mach-O; Developer ID/hardened runtime/timestamp before evidence (development ad hoc). Emit binary/SPDX SBOM/resolved provenance/notices/signature/certificate. Release Sigstore identity binds exact tag workflow; ephemeral local Ed25519 fails --require-release. Cosign3 uses --new-bundle-format=false/--use-signing-config=false with workflow/OIDC/transparency verification.

redeven.redevplugin_runtime_build.v1 binds publication/product files/target/toolchain/source/workflow/signer. Consumption rechecks descriptors/target/profile/signature. Startup trusts expected marker digest, never field binary's self-computed hash. Runtime archives contain exactly Redeven, ReDevPlugin runtime, six evidence files, license/notices.

## Desktop packages and collector

Before replacing .bundle/<target>, validate name/closed flat inventory/Go target/native policy. Gateway stays separate. Include full evidence beside Redeven. macOS exclusion regex matches only independently signed runtime; preserve its bytes/evidence. Redeven/Computer/Sparkle/bridge remain signable. After Electron assembly copy complete Computer resource tree/licenses. Validate startup before signing and again after refreshing only signer-visited Runtime/Computer descriptors, immediately before enclosing seal.

Inspect final DEB/RPM/read-only DMG and emit v2 installer-bound receipts for runtime/six evidence files. Upload only installers/receipts/latest-linux*.yml, no diagnostics/unrelated macOS YAML. Use Apple tools/system text without ripgrep and consume full pipelines under pipefail. Require Team ID/signature/hardened runtime/updater key/stapling/distribution; Sparkle lipo takes binary before -verify_arch. Separate Linux relink source/object archives from runtime. Derive epoch/windows from reviewed contract; normalize feed names before signed inventory.

DEB permits POSIX ustar/GNU regular files/directories, bounded long names/metadata-only root. RPM disables optional build-id symlinks. Bounded no-follow snapshots reject noncanonical/duplicate paths, links/devices, privileged modes, sparse/PAX metadata, malformed trailers/trailing data/oversize.

Collector requires four Runtime/Gateway package directories, four Desktop directories, and two Center directories. Inventory: four Redeven/four Gateway archives, two DEBs/two RPMs/two DMGs/six target receipts/identical shared metadata, plus both Center archives/receipts described by [release gates](ci-and-release-gates.md). Open each source once no-follow, hash/copy same descriptor, verify inode/metadata, fsync/link without replacement; clean partial output on failure.

Windows managed_wsl_archive internally certifies one Linux amd64 archive bound to version/source/size/digest, rejecting redeven.exe. Formal collector rejects all Windows directories until signed-update/signing certification; no optional fifth target.

Final release requires release-only consumption, signed checksums/safe_extract_tar.py and complete draft names/sizes/hashes comparison before publication. [Installer](self-contained-installer.md) owns verify-before-execute, immutable suite activation/retention.

# Boundaries

[CI](ci-and-release-gates.md) owns scheduling/exact-main evidence; [plugin integration](plugin-integration-gates.md) owns Host/market/UI. Unreleased/local/mutable/partial/Windows inputs cannot establish provenance. Packaging proves neither runtime behavior nor physical-host qualification.

# Evidence

- redeven:scripts/check_redevplugin_release_artifacts.sh verifies publication/registries.
- redeven:scripts/stage_redevplugin_release_artifacts.sh verifies native graph/signing.

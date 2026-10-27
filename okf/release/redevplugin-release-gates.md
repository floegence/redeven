---
type: Release Contract
title: ReDevPlugin release artifact gate
description: Verify the released ReDevPlugin publication, native runtime evidence, packaging inventory, and exact collector inputs.
tags: [release, redevplugin, artifacts, signing]
timestamp: 2026-10-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Redeven admits only the coordinated ReDevPlugin release published through its exact manifest, registry readbacks, native runtime evidence, and closed installer inventory. Every artifact is bound to the release tag, source commit, target, digest, signature identity, and package receipt before publication; partial, mutable, Windows, or target-mismatched inputs fail closed.

# Contract

## Published source and trust

Consume the coordinated ReDevPlugin release pinned in the product manifest
(currently `v3.0.37`). The boundary guard rejects sibling wiring, Go workspaces/
replacements, npm links, copied runtimes/contracts, Rust path overrides and duplicate
platform-core trees. Scans exclude generated dependencies/output and fail closed on
scanner errors. The product commits neither plugin packages nor a separate catalog
manifest: a validated latest-only market snapshot selects immutable transport, which
ReDevPlugin retrieves and verifies. Market metadata is not trust.

Upstream GitHub Release must contain exactly one `platform-release-manifest.json`.
Bind tag, source commit, release workflow and attestation, then independently verify
Go module/go.mod h1 via proxy and SumDB; both npm integrities/provenance SHA-512;
runtime/worker SDK crates.io checksums and Cargo VCS identity; and manifest version,
closed coordinate order and contract-set hash. Extra assets, partial publication,
mutable/local identity or any registry mismatch fail before construction.

Manifest transfer requires HTTPS including redirects and certificate verification.
It permits an initial attempt plus three network retries, including handshake errors,
with 15-second connect, 60-second transfer and 120-second retry-start limits. The final
transfer may finish afterward. Exhaustion cleans partial files and stops before Rust
preparation with release-specific diagnostics. Validation errors never retry.
`--manifest-file` applies the same checks offline from the transfer step. The Node
contract CLI must validate and emit requested evidence from canonical or symlinked
checkout paths; exit success without work is not evidence.

## Native construction and admission

Build every Linux/Darwin amd64/arm64 target from the exact published runtime crate,
packaged lockfile and Rust 1.88.0. Metadata cannot resolve another first-party path
dependency. Rust preparation verifies local toolchain/target first; warm caches do
not contact servers. Missing components retry only classified transient network
failures (three attempts by default, at most five); checksum, signature and manifest
failures stop. `REDEVEN_RUSTUP_OFFLINE=1` is cache-only Rustup preparation, not an
override for manifest/Cargo acquisition. Honor standard Cargo/Rustup/proxy settings,
disable probe auto-install, retain TLS, recheck successful installs and return the
exact Cargo path. Download timeout is 120 seconds; default waits are 2/4 seconds,
capped at 60. Cancellation ends retries and cleans diagnostics.

Linux must be static PIE without ELF interpreter or dynamic dependencies; Darwin
must be target-exact 64-bit Mach-O built natively. Sign Darwin release bytes with
Developer ID, hardened runtime and timestamp before computing evidence; development
uses ad hoc signing. Emit binary, SPDX SBOM, resolved-package provenance, notices
and signature/certificate. Release Sigstore identity binds the exact Redeven tag
workflow; fresh ephemeral local Ed25519 profiles fail `--require-release`. Cosign 3
explicitly retains detached format with `--new-bundle-format=false` and
`--use-signing-config=false`; verification keeps workflow, OIDC and transparency checks.

The deterministic `redeven.redevplugin_runtime_build.v1` marker binds upstream
publication, all product files, target, toolchain, Redeven source, workflow and signer.
Consumption rechecks descriptors, binary target, evidence profile and signature.
Host startup trusts this marker's expected digest, never a digest computed from the
field binary as its own trust anchor. Runtime archives contain exactly Redeven,
ReDevPlugin runtime, six evidence files, license and product notices.

## Desktop packages and collector

Before replacing `.bundle/<target>`, validate archive name, closed flat inventory,
Go target and native policy. Gateway is separate and cannot enter Desktop. Packages
include complete evidence beside Redeven. The macOS signing exclusion is a regex
anchored to the independently signed runtime executable; its bytes/evidence cannot
change. Redeven, Computer helper, Sparkle and bridge remain signable. Copy the whole
Computer resource tree after Electron assembly, preserving nested packages/licenses.
Run startup validation before signing and again after refreshing only signer-visited
Runtime/Computer descriptors immediately before the enclosing resource seal.

Native builders inspect final DEB/RPM/read-only DMG bytes and emit v2 receipts binding
the runtime and six evidence files to installer bytes. Upload only installers,
receipts and `latest-linux*.yml`; diagnostics/unrelated macOS YAML are excluded. macOS
inspection uses system text and Apple tools without requiring ripgrep; complete
pipeline output is consumed under `pipefail`. Team ID, signature, hardened runtime,
updater key, stapling and distribution policy remain mandatory. Sparkle `lipo` passes
the final binary before `-verify_arch`. Separate relink gates validate Linux source/
object archives; consumption must not mistake them for runtime archives. Compatibility
tests derive epoch/window expectations from the current reviewed contract. Normalize
Linux feeds to exact published installer names before signing the inventory.

DEB admits POSIX ustar/GNU regular files and directories, bounded GNU long names and
metadata-only root. RPM disables optional build-id symlink indexes. Bounded no-follow
snapshots reject noncanonical/duplicate paths, links/devices, privileged modes,
sparse/PAX metadata, malformed trailers, trailing data and oversized payloads.

The collector accepts exactly four package and four Desktop artifact directories:
four Redeven and four Gateway archives, two DEBs, two RPMs, two DMGs, six target-bound
receipts and identical shared metadata. Each source is opened once no-follow, hashed
and copied through that descriptor, checked for inode/metadata changes, fsynced and
linked without replacement. Failure removes partial output.

Windows `managed_wsl_archive` admits one verified Linux amd64 archive bound to version,
commit, size and digest and rejects `redeven.exe`. It is internal certification only.
The formal collector rejects every Windows artifact directory until signing and
signed-update certification exists; Windows is not an optional fifth target.

The final job requires release-only consumption, signed checksums and
`safe_extract_tar.py`, then compares the complete draft asset names, sizes and hashes
before publication. [The installer contract](self-contained-installer.md) owns
verify-before-execute, complete immutable suite activation and retention.

# Boundaries

[CI/release gates](ci-and-release-gates.md) own scheduling and exact-main evidence;
[plugin integration](plugin-integration-gates.md) owns Host, market and UI behavior.
Unreleased bytes, local wiring, mutable identities, partial evidence and Windows
artifacts cannot become formal release inputs. Packaging success is not independent
proof of runtime behavior or physical-host qualification.

# Evidence

- `redeven:scripts/check_redevplugin_release_artifacts.sh`: upstream publication and registry readbacks.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh`: exact native crate graph and signing.

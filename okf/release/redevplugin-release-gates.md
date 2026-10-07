---
type: Release Contract
title: ReDevPlugin release artifact gate
description: Verify the released ReDevPlugin publication, native runtime evidence, packaging inventory, and exact collector inputs.
tags: [release, redevplugin, artifacts, signing]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Redeven admits only the coordinated ReDevPlugin release published through its exact manifest, registry readbacks, native runtime evidence, and closed installer inventory. Every artifact is bound to the release tag, source commit, target, digest, signature identity, and package receipt before publication; partial, mutable, Windows, or target-mismatched inputs fail closed.

# Contract


Redeven consumes only the coordinated ReDevPlugin `v3.0.35` release manifest. The
boundary guard rejects local sibling paths, Go workspaces/replacements, npm
links, copied contracts or runtimes, Rust path overrides, and a second
platform-core package tree. Local-wiring scans cover maintained source, scripts,
and build configuration while excluding generated `dist` and `node_modules`
trees; a scanner error fails closed instead of being treated as no match.

The product does not commit plugin packages or a product-specific catalog
distribution manifest. Production refreshes and atomically publishes a
validated latest-only market snapshot, then ReDevPlugin retrieves and verifies
the selected immutable release transport. Focused gates cover snapshot
schema/generation, last-known-good fallback, release identity, locator mapping,
and content digests without turning market metadata into trust.

The upstream GitHub Release contains exactly one
`platform-release-manifest.json` asset. The verifier binds it to the tag,
source commit, release workflow, and GitHub attestation, then independently
reads back:

- the Go module h1 and go.mod h1 from the public proxy and SumDB;
- both npm package integrities and provenance subject SHA-512 values;
- the `redevplugin-runtime` and `redevplugin-worker-sdk` crates.io archive
  checksums and exact Cargo VCS source identities;
- the release-manifest contract version, closed coordinate ordering, and contract-set
  hash.

Partial publication, an extra GitHub Release asset, an unrecognized workflow,
local package source, mutable source identity, or any registry mismatch fails
before runtime construction.

For every native Linux and Darwin target, staging prepares Rust 1.88.0 and the
exact published `redevplugin-runtime` version with its packaged lockfile. The
Rust preparation step first verifies the exact local toolchain and target, so a
warm cache never contacts the distribution server. A missing component uses a
bounded exponential retry (three attempts by default, at most five) only for
classified transient network failures;
checksum, manifest, signature, and other deterministic failures stop
immediately. `REDEVEN_RUSTUP_OFFLINE=1` makes Rustup cache-only preparation
explicit and reports the exact missing component instead of silently switching
mirrors or weakening TLS verification; it does not disable manifest or Cargo
downloads owned by the surrounding staging flow. Standard `CARGO_HOME`,
`RUSTUP_HOME`, `RUSTUP_DIST_SERVER`, and proxy settings are honored; probes
disable Rustup auto-install. Download timeout defaults to 120 seconds per
Rustup download, retries wait 2 then 4 seconds by default, and backoff is capped
at 60 seconds. Successful installs are rechecked before returning the exact
Cargo path. Cancellation stops retrying and terminal exits clean up temporary
diagnostics.
Metadata comes from that crate and must not resolve another first-party runtime
path dependency. The fixed product toolchain links a static PIE with no ELF
interpreter or dynamic dependencies on Linux, and a target-exact 64-bit Mach-O
executable on a native macOS runner. Darwin release bytes are Developer ID
signed with hardened runtime and a timestamp before their product digest and
Sigstore evidence are created; development bytes receive an ad hoc signature.
Redeven emits the binary, SPDX SBOM, resolved-package provenance, notices, and a
signature/certificate. Release builds use Sigstore keyless identity bound to
the exact Redeven tag workflow; local builds use a fresh ephemeral Ed25519 key
and are rejected by `--require-release`.
Cosign 3 signing explicitly selects `--new-bundle-format=false` and
`--use-signing-config=false` to retain the released detached signature and
certificate contract. Verification selects the same detached format while
retaining the exact workflow identity, OIDC issuer, and transparency-log checks.

The deterministic `redeven.redevplugin_runtime_build.v1` marker embeds the
verified upstream publication and binds every product-built file, target, Rust
toolchain, Redeven source commit, workflow, and signature identity. The
consumption gate rechecks file descriptors, ELF or Mach-O target identity,
evidence profile, and signature. Linux and Darwin runtime archives contain
exactly the Redeven binary, runtime, six evidence files, license, and product
notices.

Desktop assembly validates the Redeven archive name, exact flat inventory, Go
target, and target-specific runtime policy before replacing `.bundle/<target>`.
Gateway remains a separate distribution and is rejected in Desktop installers.
Linux and Darwin Electron packages include the complete
runtime evidence beside `redeven`; macOS packaging excludes the already
Developer-ID-signed nested runtime from a second signing pass so its evidence
remains exact. The Electron Builder signing exclusion is a regular expression
anchored to that exact executable path, not a filesystem glob. The Redeven
binary, computer helper, Sparkle framework, and native bridge remain eligible
for signing. Computer resources are copied as the complete staged tree after
Electron assembly; dependency filters must not prune their nested packages or
licenses. The Desktop startup validator checks this tree before signing. The
macOS signing callback refreshes only signer-visited Runtime and Computer file
descriptors immediately before the enclosing app resource seal is signed, then
runs the same startup validator again before notarization. Independently
attested ReDevPlugin bytes and evidence may never change during this step.

Native builders inspect final DEB, RPM, or read-only DMG bytes and write v2
receipts. Desktop artifact upload selects installers, verification receipts,
and `latest-linux*.yml` feeds explicitly; builder diagnostics and unrelated
macOS YAML feeds must not enter the collector's closed inventory.
macOS package verification uses the operating system's text tools alongside
Apple's native inspection and policy tools; it does not require ripgrep on a
hosted runner. Pipeline readers consume complete command output under
`pipefail`, while signature, Team ID, hardened-runtime, updater-key, stapling,
and distribution-policy failures continue to reject the package. Sparkle
architecture verification passes the final framework binary before Apple's
`-verify_arch` option so the hosted `lipo` invocation matches the native tool
contract on both macOS targets. The ReDevPlugin consumption scan excludes the
Linux relink source/object archives from its runtime archive pattern; the
dedicated relink gate validates those archives separately. Compatibility
manifest release tests read the current reviewed contract so generated epoch
and upgrade-window assertions cannot drift from the published source. Linux
update feeds are normalized to the exact published installer names before the
closed release inventory is signed and uploaded.
The DEB parser accepts POSIX ustar and GNU regular/directory headers,
bounded GNU long names, and a metadata-only root directory. RPM packaging
disables optional build-id symlink indexes rather than admitting links into the
closed payload. Linux package parsers use
bounded no-follow snapshots and reject non-canonical paths, duplicate entries,
links, devices, privileged modes, sparse/PAX metadata, malformed trailers,
trailing data, and oversized payloads. Every native receipt binds the runtime
and all six evidence files to the exact installer bytes.

Windows assembly is a separate `managed_wsl_archive` policy: it admits one
verified `redeven_linux_amd64.tar.gz`, binds version, commit, size, and digest,
and rejects `redeven.exe`. It does not enter the formal release matrix.

Host startup takes the expected runtime digest from this product release marker;
it must not hash the field binary and accept that value as its own trust anchor.

The release collector accepts exactly four package and four Desktop artifact
directories, four Redeven archives, four Gateway archives, two DEBs, two RPMs,
two DMGs, six target-bound receipts, and byte-identical shared metadata. Each
source is opened once with `O_NOFOLLOW`, hashed and copied through the same
descriptor, checked for inode or metadata changes, fsynced, and linked without
replacement. A failed collection removes partial outputs.

Any Windows artifact directory is rejected with the signing and signed-update
certification prerequisite rather than being treated as an optional fifth
target.

The final job runs the consumption gate in release-only mode, signs checksums,
publishes `safe_extract_tar.py`, verifies the complete draft asset set by name,
size, and SHA-256, then makes the release public. The installer binds Cosign to
the selected tag, extracts the target-specific closed archive, publishes one
content-addressed suite, prepares retention, and only then changes the activation
symlink. Unknown activation links, unsupported architectures, or missing native
runtime evidence are fatal.


# Boundaries

This concept owns ReDevPlugin release provenance and package assembly. The main CI and release gate owns when this contract runs; the plugin integration concept owns Host, market, renderer, and Desktop plugin behavior. Unreleased upstream bytes, local sibling wiring, mutable source identities, partial evidence, and Windows artifacts cannot become formal release inputs.

# Evidence

- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the exact upstream publication and registry readbacks.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Builds and signs each native Linux or Darwin runtime from the exact published crate graph.
- `redeven:scripts/check_redevplugin_consumption_gate.sh:1` - Verifies runtime markers, evidence, target identity, and signatures.
- `redeven:scripts/check_desktop_redevplugin_package.sh:1` - Verifies native installer contents and writes target-bound receipts.
- `redeven:scripts/collect_release_artifacts.mjs:1` - Enforces the exact downstream release artifact inventory.
- `redeven:scripts/install.sh:1` - Verifies release identity and atomically activates the complete versioned runtime suite.
- `redeven:.github/workflows/release.yml:1` - Makes four-target runtime and installer proof mandatory.

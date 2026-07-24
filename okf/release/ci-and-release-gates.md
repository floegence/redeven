---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Redeven uses focused checks during implementation, a fast staged pre-commit
gate, and one complete integration gate for the exact main tip being pushed.
Published dependency evidence, generated assets, localized public docs, UI
behavior, Desktop/runtime bundles, Go tests, lint, and OKF must all agree. A
missing, stale, unsigned, optional, or target-mismatched ReDevPlugin artifact
fails release packaging.

# Contract

## Validation levels

Feature work runs focused checks for affected code and contracts. Pre-commit
checks only the staged diff, README localization contract, and staged
open-source hygiene. It does not run full asset, Desktop, Docker, or repository
suites.

The main pre-push hook owns final integration. It requires the checked-out local
main tip to be the pushed tip, verifies fast-forward ancestry against the
remote handshake, rejects merge commits in the unpublished range, and invokes
`scripts/check_final_integration.sh` with the exact base and tip. Evidence from
an earlier commit or pre-rebase tip does not transfer.

The final script requires a clean worktree and runs the repository contracts,
generated assets, ReDevPlugin/Gateway/Flower integration, UI/Desktop checks,
Docker Runtime E2E, OKF, serial uncached Go tests, and golangci-lint. Any
generator that changes the tree fails the gate.

## Documentation and generated assets

`README.md` is canonical. Every supported localized README must preserve
structure, links, executable literals, protected terms, hashes, and independent
subagent review recorded in `assets/readme/locales.json`. Main requires
`--require-reviewed`.

`okf/` is the maintained knowledge corpus. Source concepts must match code and
contracts, and `okf/dist/okf_bundle.json`, manifest, and checksum are generated
and committed together. Embedded Env App and Code App assets are built before
Go tests that import their embed packages.

## ReDevPlugin dependency gate

Redeven consumes only the coordinated ReDevPlugin `v0.6.10` package set. The
boundary guard rejects local sibling paths, Go workspaces/replacements, npm
links, copied contracts or runtimes, Rust path overrides, and a second
platform-core package tree. Local-wiring scans cover maintained source, scripts,
and build configuration while excluding generated `dist` and `node_modules`
trees; a scanner error fails closed instead of being treated as no match.

The Containers catalog distribution manifest separately records repository,
immutable commit, artifact path segments, and physical SHA-256. Production UI,
built-renderer smoke, and the URL gate consume that one manifest. The gate
requires the commit to be an ancestor of the product tip when locally available,
or downloads the immutable URL in a shallow CI checkout, then compares exact
bytes with the committed artifact.

The upstream GitHub Release contains exactly one
`platform-package-publication-v1.json` asset. The verifier binds it to the tag,
source commit, release workflow, and GitHub attestation, then independently
reads back:

- the Go module h1 and go.mod h1 from the public proxy and SumDB;
- both npm package integrities and provenance subject SHA-512 values;
- all six crates.io archive checksums and exact Cargo VCS source identities;
- the package-set contract version, closed coordinate ordering, and contract-set
  hash.

Partial publication, an extra GitHub Release asset, an unrecognized workflow,
local package source, mutable source identity, or any registry mismatch fails
before runtime construction.

For Linux only, staging installs Rust 1.88.0 and the exact published
`redevplugin-runtime` version with its packaged lockfile. Metadata comes from
that crate and must resolve the exact six ReDevPlugin crates from crates.io.
The fixed product toolchain links a static PIE with no ELF interpreter or
dynamic dependencies, matching the released Host admission profile. Redeven
emits the binary, SPDX SBOM, resolved-package provenance, notices, and a
signature/certificate. Release builds use Sigstore keyless identity bound to
the exact Redeven tag workflow; local builds use a fresh ephemeral Ed25519 key
and are rejected by `--require-release`.

The deterministic `redeven.redevplugin_runtime_build.v1` marker embeds the
verified upstream publication and binds every product-built file, target, Rust
toolchain, Redeven source commit, workflow, and signature identity. The
consumption gate rechecks file descriptors, ELF machine identity, evidence
profile, and signature. Linux runtime archives contain exactly the Redeven
binary, runtime, six evidence files, license, and product notices. Darwin
archives contain only Redeven, license, and product notices; any runtime or
runtime-evidence file is forbidden.

Desktop assembly validates Redeven and Gateway archive names, exact flat
inventories, Go targets, and the target-specific runtime policy before replacing
`.bundle/<target>`. Linux Electron packages include the complete runtime evidence
beside `redeven`; Darwin packages include none. Native builders inspect final
DEB, RPM, or read-only DMG bytes and write v2 receipts. Linux package parsers use
bounded no-follow snapshots and reject non-canonical paths, duplicate entries,
links, devices, privileged modes, sparse/PAX metadata, malformed trailers,
trailing data, and oversized payloads. Darwin receipts carry explicit null
runtime evidence.

The release collector accepts exactly four package and four Desktop artifact
directories, four Redeven archives, four Gateway archives, two DEBs, two RPMs,
two DMGs, six target-bound receipts, and byte-identical shared metadata. Each
source is opened once with `O_NOFOLLOW`, hashed and copied through the same
descriptor, checked for inode or metadata changes, fsynced, and linked without
replacement. A failed collection removes partial outputs.

The final job runs the consumption gate in release-only mode, signs checksums,
publishes `safe_extract_tar.py`, verifies the complete draft asset set by name,
size, and SHA-256, then makes the release public. The installer binds Cosign to
the selected tag, extracts the target-specific closed archive, publishes one
content-addressed suite, prepares retention, and only then changes the activation
symlink. Unknown activation links, unsupported architectures, missing Linux
runtime evidence, or any Darwin runtime payload are fatal.

## Plugin integration gate

The focused plugin gate covers:

- Host construction, authenticated owner/session mapping, direct authorization,
  explicit origin/CSRF/action policy, and stable observability;
- signed official release-ref install/update and exact publisher/plugin/instance
  identity;
- public HTTPS URL, GitHub Release, and local `.redevplugin` inspect-confirm-
  commit admission, strict source provenance, signature assessment, disabled
  zero-grant commit state, bounded query-only reconciliation, and no mutation
  replay after an unknown or in-progress outcome;
- the exact manifest-derived Containers package URL through the Redeven HTTP
  integration, including staged package bytes, unsigned review, digest-bound
  commit, disabled `manual_only` result, user approval, and zero active grants;
- runtime path/target/hash, ProcessManager health, persistent lease replay, and
  Host storage/network/stream services;
- the signed Containers capability, operation/cancellation/stream behavior, and
  domain-only container package boundary;
- canonical AppServer route reservation/delegation and Local UI access checks;
- generated UI lifecycle DTOs, management revisions, production Plugin entry,
  generic permission requirements, exact inventory-key selection, full external
  security and source-provenance review, exact generic permission ids, FIFO
  confirmation, and close-before-placement lifecycle;
- Shell-root multi-window Activity chrome, standard `redeven.plugin` Workbench
  persistence, released interaction ownership, exact-surface close
  reconciliation, and cross-placement serialization;
- static absence of legacy proxy/bootstrap/base64 package and copied platform
  paths.

The built renderer smoke requires the Plugins Activity entry, opens the panel
and Plugin Center, clicks the Containers install action, reviews the
manifest-derived immutable URL, requires explicit digest confirmation, commits
the unsigned package, and observes completion without calling the release-ref
mutation. The refreshed installed view must show the package as unsigned and
disabled with zero active grants. The smoke validates the exact inspect and
commit request bodies and request sequence, accepts only canonical ReDevPlugin
envelopes, and also verifies content-hashed JS/CSS/WASM, non-blank root output,
and zero console, page, request, or HTTP failures.

Browser-facing reads use the released POST query contract and retain exact
Origin, CSRF, action, and query-effect authorization. Session disconnect uses
the released durable four-hash fence and drain; Redeven awaits exact teardown
acknowledgement before deleting identity and reconciles retained fences on
restart.

Workbench plugin interaction is releasable only through the `v0.6.10`
source/port-bound interaction ownership and exact-surface close contracts. The
gate rejects overlays, pointer-event switching, copied interaction DTOs, a
second bridge, session-wide close fallback, placement persistence before close,
or local disposal presented as server revocation.

## Other published boundaries

Floret follows the same published-dependency discipline. The boundary guard
rejects sibling wiring, internal imports, and direct access to Floret-owned
schema. Gateway protocol drift fails before packaging. Runtime/Desktop
compatibility uses its checked-in compatibility contract, not release-note or
Desktop conditionals.

# Boundaries

CI confirms a locally validated pushed tip; it is not the first validator.
Release jobs do not accept partial ReDevPlugin evidence or mutable repository
configuration as provenance. Generated contracts, markers, lockfiles, assets,
and OKF are regenerated from authoritative sources instead of manually stitched.

Unreleased ReDevPlugin or Floret behavior is not a valid main dependency.
Integration experiments may exist only on an unmerged feature branch and may
not become a fallback, shim, or local artifact path.

# Evidence

- `redeven:.githooks/pre-commit:1` - Defines the fast staged gate.
- `redeven:.githooks/pre-push:1` - Binds full validation to the exact main push.
- `redeven:scripts/check_final_integration.sh:1` - Defines the complete local integration gate.
- `redeven:scripts/check_plugin_integration.sh:1` - Defines focused ReDevPlugin integration coverage.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects maintained local source wiring and fails closed on scan errors.
- `redeven:scripts/check_catalog_plugin_package_url.mjs:1` - Binds the catalog distribution manifest to immutable package bytes.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the exact-one upstream publication and registry readbacks.
- `redeven:scripts/check_redevplugin_consumption_gate.sh:1` - Verifies the product runtime marker, evidence, target, and signature.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Builds and signs the Linux runtime from the exact published crate graph.
- `redeven:scripts/link_redevplugin_runtime_static_pie.sh:1` - Enforces the closed static PIE linker profile required by runtime admission.
- `redeven:scripts/safe_extract_tar.py:1` - Enforces bounded, typed, inode-bound archive extraction and atomic directory publication.
- `redeven:scripts/build_desktop_bundled_runtime.sh:1` - Stages the formal runtime into Desktop bundles.
- `redeven:scripts/check_desktop_redevplugin_package.sh:1` - Verifies final native installer contents and writes target-bound receipts.
- `redeven:scripts/extract_desktop_runtime.py:1` - Parses Linux package payload streams and extracts only the closed runtime inventory.
- `redeven:scripts/collect_release_artifacts.mjs:1` - Enforces the exact downstream release artifact inventory.
- `redeven:scripts/install.sh:1` - Verifies exact release identity and atomically activates the complete versioned runtime suite.
- `redeven:.github/workflows/release.yml:1` - Makes least-privilege four-target runtime and installer proof mandatory.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Verifies the production Plugin entry and built renderer.
- `redeven:scripts/check_readme_localizations.mjs:1` - Enforces public README localization and review metadata.
- `redeven:scripts/okf/check_source_integrity.sh:1` - Validates the maintained OKF corpus.

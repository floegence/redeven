---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-product exact-main release contract spanning dependencies, generated assets, tests, packaging, signing evidence, and publication gates.
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

Ordinary push and pull-request Actions run one bounded source-only job. CodeQL
is a separate asynchronous discovery lane: it runs on a daily schedule or
manual dispatch, never from push or pull request. Before a scheduled analysis,
the plan job compares the current `main` SHA with the most recent successful
scheduled CodeQL run. An unchanged SHA skips the language matrix; an API lookup
failure fails safe by scanning. This preserves daily detection for changed code
without making hosted analysis part of the normal development gate.

The hosted source job and exact-main gate both reject non-canonical formatting
in any tracked Go file. The exact-main check reports every affected path before
the expensive integration stages begin, and a source-only policy test prevents
the local gate from drifting behind the cloud formatting contract.

The main pre-push hook owns final integration. It requires the checked-out local
main tip to be the pushed tip, verifies fast-forward ancestry against the
remote handshake, rejects merge commits in the unpublished range, and invokes
`scripts/check_final_integration.sh` with the exact base and tip. Evidence from
an earlier commit or pre-rebase tip does not transfer.

The final script requires a clean worktree and runs the repository contracts,
generated assets, ReDevPlugin/Gateway/Flower integration, UI/Desktop checks,
Docker Runtime E2E, OKF, serial uncached Go tests, and golangci-lint. Any
generator that changes the tree fails the gate.

`go.mod` is the single authoritative Go toolchain version and currently pins
Go 1.26.6. Every GitHub Actions `setup-go` step resolves that file through
`go-version-file: go.mod`; owned container capability checks select the matching
`GOTOOLCHAIN=go1.26.6+auto`; public README prerequisites and badges mirror the
same value. Quick CI and the exact-main final integration gate run
`scripts/check_go_version_consistency.mjs`, which rejects drift among these
sources and requires the local gate runtime to report the exact version. Build,
test, Desktop, and release paths therefore cannot silently select an older Go
patch release.

`.node-version` is the single authoritative first-party Node.js toolchain and
pins Node 26.7.0. GitHub Actions resolves it through `node-version-file`, while
Desktop, Env App, and Code App package engines accept only Node 26. Shared UI
and Desktop development helpers reject other Node majors before dependency or
build work begins, and the public README badges and prerequisites mirror the
same exact version.

Shipped Redeven Runtime binaries use cgo plus the `floeterm_native` tag so the
published terminal-go Ghostty engine is present. The release matrix builds
Linux amd64/arm64 and Darwin amd64/arm64 on matching native runners and never
cross-builds a Darwin Runtime from Linux. The exact-main gate runs the full Go
suite and golangci-lint with that tag, then separately proves that an untagged
terminal live attachment fails closed rather than acting as a product fallback.
A source-only contract test guards release, Desktop bundle, SSH source-build,
and semantic carrier commands against reverting to `CGO_ENABLED=0` or omitting
the native tag.

The exact-main UI and renderer steps invoke the canonical headless browser and
terminal carrier gates without a display server. Explicit headed runs are
manual diagnostics and cannot replace exact-main evidence. Browser-mode and
runner-evidence semantics are owned by [Env App upstream web dependencies](../architecture/env-app-upstream-web-dependencies.md).
The gate builds the embedded UI assets from the exact main source before those
browser steps; an ignored or previously generated `internal/envapp/ui/dist`
tree is never accepted as carrier input.

The Desktop gate protects real Electron preload coverage from local process
collisions. Every preload run uses a temporary real working directory and
separate utility/session user-data directories, then verifies both paths inside
Electron before inspecting bridge surfaces. It starts headless with a random
integration marker and owns either a dedicated POSIX process group or an exact
Windows process tree while its spawned leader remains addressable. Timeout,
output overflow, and POSIX abnormal-close cleanup target only that spawned group
and wait for it to drain. An unexplained external
`SIGKILL` remains a gate failure and is never converted to success by retry or
name-based process substitution. Before real Electron coverage, the full gate
runs a non-mutating, non-interactive execution preflight against the exact npm
Electron binary. The preflight resolves package-manager symlinks, requires the
package root to remain inside Desktop `node_modules`, matches the installed
version to the exact `package.json` pin, and executes only that package's standard
binary path. Signal termination or macOS AMFI rejection fails as an explicit
environment error. Tests and gates never sign Electron, use developer signing
identities, or mutate `node_modules` to change the host trust decision. These
test-runtime rules do not change Dev Desktop launch or shutdown behavior.

## Documentation and generated assets

`README.md` is canonical. Every supported localized README must preserve
structure, links, executable and inline-code literals, protected terms, and the
current canonical and localized content hashes recorded as synchronization
metadata in `assets/readme/locales.json`. The machine gate does not accept or
require reviewer identity, review method, or approval-count metadata.

`okf/` is the maintained knowledge corpus. Source concepts must match code and
contracts, and `okf/dist/okf_bundle.json`, manifest, and checksum are generated
and committed together. Embedded Env App and Code App assets are built before
Go tests that import their embed packages.

## ReDevPlugin dependency gate

Redeven consumes only the coordinated ReDevPlugin `v3.0.5` release manifest. The
boundary guard rejects local sibling paths, Go workspaces/replacements, npm
links, copied contracts or runtimes, Rust path overrides, and a second
platform-core package tree. Local-wiring scans cover maintained source, scripts,
and build configuration while excluding generated `dist` and `node_modules`
trees; a scanner error fails closed instead of being treated as no match.

The product does not commit a Containers package or catalog distribution
manifest. Production refreshes and atomically publishes a validated latest-only market snapshot, then
ReDevPlugin retrieves and verifies the exact immutable GitHub Release transport.
Focused gates cover snapshot schema/generation, last-known-good fallback,
official anchor pins, release identity, complete locator mapping, and content
digests without turning market metadata into trust.

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

For Linux only, staging installs Rust 1.88.0 and the exact published
`redevplugin-runtime` version with its packaged lockfile. Metadata comes from
that crate and must not resolve another first-party runtime path dependency.
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

Host startup takes the expected runtime digest from this product release marker;
it must not hash the field binary and accept that value as its own trust anchor.

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
- public HTTPS URL, GitHub Release, and local `.redevplugin`
  inspect-confirm-install admission, process-local TTL inspection identity,
  strict source provenance, exact owner/session/bytes/hash revalidation,
  disabled zero-grant install state, and no durable receipt/query lifecycle;
- the market-selected Containers release through Redeven HTTP integration,
  including frozen snapshot identity, complete remote assets, signed release-ref
  install, and zero implicit grants;
- runtime path/target/hash, ProcessManager health, persistent lease replay, and
  Host storage/network/Event services;
- the Host-known Containers capability, Execution/cancellation/Event behavior, and
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

The built renderer smoke requires the Plugins Activity entry, opens Plugin
Center, consumes the frozen market projection, and submits the exact signed
release-ref install command without opening an external package URL flow. It
still verifies zero implicit grants, canonical ReDevPlugin envelopes,
content-hashed JS/CSS, absence of the removed browser terminal WASM artifact,
non-blank root output, and zero console, page, request, or HTTP failures.
Offline projection keeps installed plugins visible
and reports one retryable catalog-unavailable state.

Browser-facing reads use the released POST query contract and retain exact
Origin, CSRF, action, and query-effect authorization. Session disconnect uses
the released durable four-hash fence and drain; Redeven awaits exact teardown
acknowledgement before deleting identity and reconciles retained fences on
restart.

Workbench plugin interaction is releasable only through the `v3.0.5`
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
- `redeven:scripts/check_quick_ci.sh:1` - Defines the bounded hosted source and Go formatting checks.
- `redeven:scripts/check_final_integration.sh:1` - Defines the complete local integration gate.
- `redeven:scripts/quick_ci_policy.test.mjs:1` - Keeps the hosted and exact-main Go formatting contracts aligned.
- `redeven:scripts/check_go_version_consistency.mjs:1` - Binds Go workflows, capability checks, public prerequisites, and the local gate runtime to `go.mod`.
- `redeven:scripts/check_desktop_electron_test_runtime.sh:1` - Fails closed when the exact npm Electron runtime cannot execute without modifying host trust.
- `redeven:desktop/src/build/desktopPreloadRuntime.test.ts:1` - Runs real Electron preload bridges in isolated working and user-data directories.
- `redeven:scripts/check_plugin_integration.sh:1` - Defines focused ReDevPlugin integration coverage.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects maintained local source wiring and fails closed on scan errors.
- `redeven:internal/pluginmarket/service_test.go:1` - Proves strict market validation, complete remote transport, and last-known-good fallback.
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
- `redeven:.github/workflows/codeql.yml:1` - Runs daily changed-main security analysis outside ordinary push and pull-request CI.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Verifies the production Plugin entry and built renderer.
- `redeven:scripts/check_readme_localizations.mjs:1` - Enforces public README localization structure, terminology, literals, and synchronization hashes.
- `redeven:scripts/okf/check_source_integrity.sh:1` - Validates the maintained OKF corpus.

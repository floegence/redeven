---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-07-19T00:00:00Z
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

Redeven consumes only formal ReDevPlugin `v0.5.1` artifacts. The boundary guard
rejects local sibling paths, Go workspaces/replacements, npm links, copied
contracts, copied runtimes, and a second platform-core package tree.

The release verifier requires exactly 27 upstream assets and validates:

- release-manifest v4, compatibility-manifest v6, and exactly 28 contracts;
- fixed source commit, checksum-set hash, compatibility hash, contract registry
  hash, npm tarball/integrity, and Worker SDK;
- all four runtime tarballs, target/hash/manifest, safe archive shape, and notices;
- A2 report/screenshots and release stress evidence;
- the exact keyless release workflow identity and all signatures/bundles.

Deterministic marker `redeven.redevplugin_artifact_verification.v4` binds hashes
and sizes for the complete verified set. Marker v3, missing/symlink/unbounded
payloads, and target mismatches are rejected. The downstream consumption gate
also pins the complete approved v0.5.1 marker profile; a structurally valid or
self-consistent marker for another release cannot authorize a payload.

The staging command has no production repository, version, source-directory,
or signature-skip override. It always downloads `floegence/redevplugin v0.5.1`,
verifies the closed asset set, selects the exact GOOS/GOARCH target, and stages
runtime, notices, and marker. Archive validation and extraction share one
`O_NOFOLLOW` file descriptor, bind compressed size and SHA-256, cap entries,
expanded file bytes, and the complete tar stream, and reject traversal,
non-canonical paths, links, devices, sparse/PAX metadata, privileged modes,
duplicate paths, multiple roots, and unexpected inventory. Verified staging is
published with an atomic no-replace directory operation; an existing or unsafe
destination is rejected.

Release matrix jobs always include the verified runtime, notices, and marker in
each Redeven runtime tarball and package artifact. Desktop assembly validates
the Redeven and Gateway archive filenames, exact flat inventories, Go binary
targets, formal ReDevPlugin target, and complete bundle in a private sibling
directory before atomically replacing `.bundle/<target>`. Electron packages
the runtime, notice, and marker beside `redeven`; `afterPack` checks the app
staging directory, and each native builder then inspects its final DEB, RPM, or
read-only mounted DMG and writes a receipt bound to installer bytes, target,
runtime, notice, and marker hashes. Linux inspection first snapshots the package
through one no-follow descriptor, then parses the DEB tar or RPM newc stream
without invoking a filesystem extractor. It rejects non-canonical or duplicate
paths, file/directory prefix conflicts, GNU/PAX/sparse metadata, links, devices,
unexpected privileged modes, hard links, non-canonical trailers, non-zero or
unbounded trailing data, excessive entry counts, and more than 2 GiB of declared
payload. Selected executables must be root-owned mode `0755`; the marker and
notices must be root-owned mode `0644`. The parser materializes only those five
exact runtime files and requires EOF under the same interpretation used for the
closed inventory.

The release collector accepts exactly four package artifact directories and
four Desktop artifact directories. It proves the closed set of four Redeven
tarballs, four Gateway tarballs, two DEBs, two RPMs, two DMGs, six installer
receipts, byte-identical shared metadata, and one byte-identical marker before
publishing named assets. Each source is opened once with `O_NOFOLLOW`; the same
descriptor is hashed and copied into private same-filesystem staging, checked
for inode or metadata changes, fsynced, and linked into the destination without
replacement. A failed publication removes every partial output.

The final job signs and publishes `safe_extract_tar.py`. It refuses an existing
release, creates a draft, uploads without clobber, downloads the draft assets,
compares the exact name, size, and SHA-256 set, and only then makes the release
public. The standalone marker asset has a non-hidden release name because
GitHub normalizes leading-dot asset names; the runtime archives retain the
canonical hidden marker path. The public installer binds Cosign to the exact
selected tag, verifies the extractor through those signed checksums, extracts
exactly the six runtime archive files, publishes them as one content-addressed
versioned suite, prepares pinned ripgrep and retention, and only then atomically
replaces the `redeven` activation symlink. The existing activation must be an
executable pre-suite migration file or the exact closed relative suite link;
unknown links and inventory entries fail closed. Retention keeps the active and
new suite during the commit, yielding current plus previous after activation.
No fallible companion installation runs after activation. Unsupported
architectures and a failed binary check are fatal. Read-only jobs receive only
read permissions; only the final release job receives `contents: write` and
OIDC. Go compilation and npm packaging do not receive `GH_TOKEN`.

This exact proof exposes a Darwin release blocker rather than weakening it.
ReDevPlugin v0.5.1's Darwin runtime is linker/ad-hoc signed without a Developer
ID team. Electron signs nested Mach-O executables for notarization, which changes
the runtime bytes and invalidates the formal marker/runtime-manager SHA-256.
Redeven must not ignore the runtime during signing, accept the changed hash, or
rewrite upstream evidence. A formal ReDevPlugin release must provide a Darwin
signing/identity contract and artifact compatible with host notarization before
the macOS Desktop jobs can pass.

## Plugin integration gate

The focused plugin gate covers:

- Host construction, authenticated owner/session mapping, direct authorization,
  explicit origin/CSRF/action policy, and stable observability;
- signed official release-ref install/update and exact publisher/plugin/instance
  identity;
- runtime path/target/hash, ProcessManager health, persistent lease replay, and
  Host storage/network/stream services;
- the signed Containers capability, operation/cancellation/stream behavior, and
  domain-only container package boundary;
- canonical AppServer route reservation/delegation and Local UI access checks;
- generated UI lifecycle DTOs, management revisions, production Plugin entry,
  FIFO confirmation, and close-before-open slot lifecycle;
- static absence of legacy proxy/bootstrap/base64 package and copied platform
  paths.

The built renderer smoke requires the Plugins Activity entry, opens
the panel, observes the Plugin Center tile, and accepts only the canonical
ReDevPlugin catalog request envelope. It also verifies content-hashed JS/CSS/WASM,
non-blank root output, and zero console, page, request, or HTTP failures.

That fixture is not browser-to-Go origin evidence. Activity remains blocked:
its GET omits Origin while the guard denies missing Origin. A formal upstream
contract and real-browser test are required; local exceptions are prohibited.

Session disconnect also remains blocked. One four-hash revoke must fence new
work and cancel surfaces, tokens, handles, confirmations, operations, and
streams without affecting a sibling channel. Redeven must await it before
deleting identity; local scans or timers do not satisfy the gate.

Workbench plugin interaction is not declared passing: v0.5.1 lacks the required
host-neutral iframe interaction ownership contract. A Redeven release must not
hide that gap behind an overlay or input patch. Workbench enablement requires a
new formal ReDevPlugin release and corresponding focused/browser evidence.

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
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the closed formal upstream asset set.
- `redeven:scripts/check_redevplugin_consumption_gate.sh:1` - Binds payloads to marker v4 and exact target.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Performs fixed formal staging.
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

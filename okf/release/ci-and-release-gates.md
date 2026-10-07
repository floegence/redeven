---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-10-07T00:00:00Z
quality_exception: Exact-main validation order spanning repository checks, generated assets, published dependency contracts, Desktop updates, and compatibility evidence.
---
# Summary

Redeven uses focused checks during implementation, a fast staged pre-commit
gate, and one complete integration gate for the exact main tip being pushed.
Published dependency evidence, generated assets, localized public docs, UI
behavior, Desktop/runtime bundles, Go tests, lint, and OKF must all agree. A
missing, stale, unsigned, optional, or target-mismatched ReDevPlugin artifact
fails release packaging.
Windows is an internal certification target only; the formal release inventory
fails closed if any Windows asset appears.

# Contract

## Validation levels

Feature work runs focused checks for affected code and contracts. Pre-commit
checks the staged diff, README localization contract, staged open-source
hygiene, and third-party notices when dependency or attribution inputs change.
It does not run full asset, Desktop, Docker, or repository suites.

Secret scanning excludes the downloaded SwiftPM dependency checkouts under
`desktop/native/computer-host/.build/checkouts/`, like the configured npm
dependency caches. Redeven native sources and other build output remain scanned;
upstream fixture literals must not require disabling a rule for product code.

The notice check exports the Git index to a temporary tree and calls that
tree's existing generator with `--check`. It checks the content being committed,
including partial staging; an unstaged notice update cannot satisfy it. The
snapshot reads installed package metadata from the current checkout and uses
only the local Go toolchain and module cache, with proxy, checksum-server, and
VCS downloads disabled. Unrelated commits skip this check. Missing prerequisites
or stale output stop the commit with instructions to prepare dependencies,
regenerate notices, and stage matching inputs. Success and failure remove the
temporary tree without rewriting working files or the index.

Ordinary push and pull-request Actions run one bounded source-only job. CodeQL
is a separate asynchronous discovery lane: it runs on a daily schedule or
manual dispatch, never from push or pull request. Before a scheduled analysis,
the plan job compares the current `main` SHA with the most recent successful
scheduled CodeQL run. An unchanged SHA skips the language matrix; an API lookup
failure fails safe by scanning. This preserves daily detection for changed code
without making hosted analysis part of the normal development gate.

Every external GitHub Action is pinned to a reviewed commit, including the
certificate-import action that receives signing secrets. Node-based Actions
use supported Node 24 runtimes independently of the product Node 26 toolchain.

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
Go 1.27.1. Every GitHub Actions `setup-go` step resolves that file through
`go-version-file: go.mod`; repository checks select the matching
`GOTOOLCHAIN=go1.27.1+auto`; public README prerequisites and badges mirror the
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

Desktop pnpm installation permits lifecycle scripts only for `electron` and
`esbuild`. It explicitly ignores `electron-winstaller`'s Squirrel 7-Zip setup:
the internal Windows target uses NSIS. New script-bearing dependencies still
require review. After a dependency update, regenerate `THIRD_PARTY_NOTICES.md`
from the locked packages with `scripts/generate_third_party_notices.mjs` and
verify it with `--check` before integration.

Shipped Redeven Runtime binaries use cgo plus the `floeterm_native` tag so the
published terminal-go Ghostty engine is present. The release matrix builds
Linux amd64/arm64 and Darwin amd64/arm64 on matching native runners and never
cross-builds a Darwin Runtime from Linux. The exact-main gate runs the full Go
suite and golangci-lint with that tag, then separately proves that an untagged
terminal live attachment fails closed rather than acting as a product fallback.
A source-only contract test guards release, Desktop bundle, SSH source-build,
and semantic carrier commands against reverting to `CGO_ENABLED=0` or omitting
the native tag.

Release runtime commands must also execute under the macOS runner's system
Bash 3.2 with strict error handling. The build step starts with its required
arguments and appends Linux-only relink options, so Darwin never expands an
empty array under `set -u`. The native build contract test executes the actual
workflow step through `/bin/bash` with a recording builder for all four targets,
checking exact arguments without compiling packages or accessing credentials.

Every hosted job that creates or consumes signed ReDevPlugin runtime artifacts
installs the pinned Cosign action before that operation. Desktop packaging must
verify the release-profile runtime signature on its own clean runner; an earlier
build job's installed tools do not carry across jobs. A source-only workflow
contract guards this prerequisite for build, Desktop, and release collection.
Each native Desktop job also enables Corepack and installs the frozen Env App
UI dependency lock before packaging. Computer-resource staging resolves its
JavaScript helpers from that package root, including Playwright and QuickJS;
the Runtime job's installed dependencies do not carry into the Desktop runner.
This prerequisite stages helper packages only and does not install browser
binaries or run browser tests in the release workflow.
Desktop bundle staging captures its exact cleanup path before installing the
exit trap, so both system Bash 3.2 and newer Linux Bash preserve the original
failure status and remove only that invocation's temporary staging directory.

Computer qualification proxies accept only the fixed provider Responses POST
route. Request paths cannot redirect provider credentials to another origin.
Desktop Runtime log tails inspect and read one no-follow file descriptor, so a
path replacement cannot change the file between sizing and reading. Release
source verification and Sparkle private-key reads also verify the opened
no-follow descriptor rather than checking one path and reading it later.
Temporary Flower qualification credentials are written and permissioned through
one no-follow descriptor. Terminal carrier TLS fingerprints are accepted only
after the server authenticates against that run's isolated device CA; an
unrelated certificate cannot become a browser trust exception.

The exact-main UI and renderer steps invoke the canonical headless browser and
terminal carrier gates without a display server. Explicit headed runs are
manual diagnostics and cannot replace exact-main evidence. Browser-mode and
runner-evidence semantics are owned by [Env App upstream web dependencies](../architecture/env-app-upstream-web-dependencies.md).
The gate builds the embedded UI assets from the exact main source before those
browser steps; an ignored or previously generated `internal/envapp/ui/dist`
tree is never accepted as carrier input.

Env App's `pnpm build` owns one checkout-local kernel lock across cache cleanup,
TypeScript, Vite output replacement, initial-budget validation, and gzip/Brotli
generation. The Python 3 launcher uses `flock` on the supported Linux/macOS build
hosts and passes the descriptor to the build shell and its children. Concurrent
builds in the same checkout wait; separate worktrees remain independent. A failed
or interrupted build releases ownership when its processes exit, without stale
PID recovery or deleting another builder's lock file. `build_assets.sh` delegates
to that package command and must not compress its output after the lock is
released. Missing assets remain build failures and must not be silently skipped.

Desktop and shared Flower tests that consume renderer-only Floe APIs run in the client Vitest suite with browser resolution and a DOM environment. Server-side test resolution must not replace or bypass published cryptographic tools to load those tests. UI mocks retain the real upstream utility exports unless the utility itself is the boundary under test.

Headless UI tests keep browser scrollbars enabled so geometry assertions observe
real scrollbar layout. Fixtures requiring space-consuming scrollbars explicitly
reset the standard scrollbar properties before setting a custom width; system
overlay preferences and theme colors must not disable that coverage. Dialog
focus checks await the upstream restoration after the unmount paint.

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

The manual `Windows WSL Certification` workflow is outside ordinary push and
pull-request CI and requires exact `origin/main`. An Ubuntu job builds the
matching Linux amd64 Runtime archive from that commit. A `windows-2025` job runs
Desktop tests, creates two temporary WSL 2 distributions, verifies isolated
install, Start, private Bridge, external distribution shutdown, explicit retry,
Update, and exact Stop behavior, then builds an unsigned per-user internal NSIS
artifact. Workflow cleanup may unregister only its temporary test
distributions; product code never performs that system operation.

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


## Focused release contracts

The published ReDevPlugin artifact and plugin surface contracts are maintained as focused concepts so this gate remains the owner of exact-main validation order and evidence handoff:

- [ReDevPlugin release artifact gate](redevplugin-release-gates.md) owns upstream publication, runtime evidence, native packaging, and collector inventory.
- [Plugin integration gate](plugin-integration-gates.md) owns Host/market/plugin UI integration and its isolated renderer and Desktop smokes.
## Desktop update publication

The protected `redeven-release` environment supplies Developer ID signing,
notarization, Sparkle Ed25519, and expected Team ID secrets without committing
their values. Packaged Desktop builds inject only a credential-free HTTPS feed
URL and the Sparkle public key. macOS packages are checked for the Sparkle
framework, native bridge, architecture, hardened runtime, notarization, and
stapling. Electron Builder signs and notarizes the App, then signs the final
DMG. The hosted Desktop job submits that exact disk image to Apple, requires an
`Accepted` result within its bounded wait, and staples and validates its ticket
before installer receipts or Sparkle metadata are generated. Verification binds
the App, framework, bridge, and DMG to the expected Team ID, validates both
stapled tickets, and uses `syspolicy_check distribution` on the native macOS
release runner for the App's Gatekeeper assessment. Linux packages publish
matching `latest-linux.yml` metadata for each architecture.

Stable tags run a macOS Sparkle job that generates two appcasts with no delta
packages, signs the appcasts and release notes, verifies their enclosure and
release-note signatures, and removes temporary private-key files. Prerelease
tags skip that job and the release collector rejects any stable-feed asset.
Appcasts, signed notes, Linux metadata, and installers are included in the
aggregate checksum and remote readback comparison before publication.

## Flower storage compatibility

The [historical writer contract](../ai/flower-upgrade-compatibility.md) is part
of every final main integration, including Floret dependency upgrades. Ordinary
CI checks immutable fixture digests, producer provenance and frozen decoder
boundaries without opening databases or building a historical runtime. The
uncached Go suite in the final main gate copies every fixture and runs the real
product upgrade, new-turn continuation and second-start checks. Failure and
restore tests cover WAL, cross-owner retry, zero execution during preparation,
backup protection, full-set replacement interruption and stale outbox rejection.

## Other published boundaries

Floret follows the same published-dependency discipline. The boundary guard
rejects sibling wiring, internal imports, and direct access to Floret-owned
schema. Gateway protocol drift fails before packaging. Runtime/Desktop
compatibility uses its checked-in compatibility contract, not release-note or
Desktop conditionals.

Browser tests store generated screenshots in `src/**/__screenshots__/`, runtime
attachments in `.vitest-attachments/`, and named PDF/progress evidence under
`.cache/`. These generated paths and the explicit control-harmony and
settings-design outputs are
ignored; source fixtures remain tracked. Workbench PDF drag tests remove only
the Vitest runner's outer preview scaling while preserving the product canvas
projection, then restore the runner styles after the interaction.

# Boundaries

CI confirms a locally validated pushed tip; it is not the first validator.
Release jobs do not accept partial ReDevPlugin evidence or mutable repository
configuration as provenance. Generated contracts, markers, lockfiles, assets,
and OKF are regenerated from authoritative sources instead of manually stitched.

Unreleased ReDevPlugin or Floret behavior is not a valid main dependency.
Integration experiments may exist only on an unmerged feature branch and may
not become a fallback, shim, or local artifact path.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/build.py` - Owns the complete Env App asset build under a checkout-local kernel lock.
- `redeven:internal/envapp/ui_src/scripts/buildEnvApp.node-test.mjs` - Exercises overlapping builds, compression ownership, failure/signal release, and independent worktrees.

- `redeven:.githooks/pre-commit:1` - Defines the fast staged gate.
- `redeven:.githooks/pre-push:1` - Binds full validation to the exact main push.
- `redeven:scripts/check_quick_ci.sh:1` - Defines the bounded hosted source and Go formatting checks.
- `redeven:scripts/check_final_integration.sh:1` - Defines the complete local integration gate.
- `redeven:scripts/quick_ci_policy.test.mjs:1` - Keeps the hosted and exact-main Go formatting contracts aligned.
- `redeven:scripts/check_go_version_consistency.mjs:1` - Binds Go workflows, capability checks, public prerequisites, and the local gate runtime to `go.mod`.
- `redeven:desktop/package.json` - Pins the Desktop package manager and explicit dependency lifecycle-script policy.
- `redeven:desktop/electron-builder.config.mjs` - Selects NSIS for the internal Windows target.
- `redeven:scripts/generate_third_party_notices.mjs` - Generates and checks attribution against locked dependencies.
- `redeven:scripts/check_staged_third_party_notices.mjs` - Runs the same checker offline against staged content only when its inputs change.
- `redeven:scripts/check_staged_third_party_notices.test.mjs` - Exercises stale and partially staged notices, missing dependencies, cleanup, and actual commit rejection.
- `redeven:scripts/check_desktop_electron_test_runtime.sh:1` - Fails closed when the exact npm Electron runtime cannot execute without modifying host trust.
- `redeven:desktop/src/build/desktopPreloadRuntime.test.ts:1` - Runs real Electron preload bridges in isolated working and user-data directories.
- `redeven:scripts/check_plugin_integration.sh:1` - Defines focused ReDevPlugin integration coverage.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects maintained local source wiring and fails closed on scan errors.
- `redeven:internal/pluginmarket/service_test.go:1` - Proves strict market validation, complete remote transport, and last-known-good fallback.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the exact-one upstream publication and registry readbacks.
- `redeven:scripts/check_redevplugin_consumption_gate.sh:1` - Verifies the product runtime marker, evidence, target, and signature.
- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Builds and signs each native Linux or Darwin runtime from the exact published crate graph.
- `redeven:scripts/prepare_redevplugin_rust_toolchain.sh:1` - Reuses verified local Rust components and bounds transient Rustup recovery without changing trust or source selection.
- `redeven:scripts/redevplugin_rust_toolchain.test.mjs:1` - Covers cache reuse, transient retry, deterministic failure, offline mode, and retry-policy bounds with a fake Rustup.
- `redeven:scripts/link_redevplugin_runtime_static_pie.sh:1` - Enforces the closed static PIE linker profile required by runtime admission.
- `redeven:scripts/safe_extract_tar.py:1` - Enforces bounded, typed, inode-bound archive extraction and atomic directory publication.
- `redeven:scripts/build_desktop_bundled_runtime.sh:1` - Stages the formal runtime into Desktop bundles.
- `redeven:scripts/check_desktop_redevplugin_package.sh:1` - Verifies final native installer contents and writes target-bound receipts.
- `redeven:scripts/extract_desktop_runtime.py:1` - Parses Linux package payload streams and extracts only the closed runtime inventory.
- `redeven:desktop/scripts/sign-packaged-runtime.mjs:1` - Binds signed resource bytes before the app seal and validates the complete packaged Runtime.
- `redeven:scripts/collect_release_artifacts.mjs:1` - Enforces the exact downstream release artifact inventory.
- `redeven:scripts/install.sh:1` - Verifies exact release identity and atomically activates the complete versioned runtime suite.
- `redeven:.github/workflows/release.yml:1` - Makes least-privilege four-target runtime and installer proof mandatory.
- `redeven:.github/workflows/codeql.yml:1` - Runs daily changed-main security analysis outside ordinary push and pull-request CI.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Verifies the production Plugin entry and built renderer.
- `redeven:internal/envapp/ui_src/vitest.browser.config.ts:1` - Keeps scrollbars observable in headless UI tests.
- `redeven:internal/envapp/ui_src/src/ui/pages/GitTemplateImport.browser.test.tsx:1` - Checks stable dialog geometry with space-consuming scrollbars.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Checks retained management state and deferred focus restoration.
- `redeven:scripts/check_readme_localizations.mjs:1` - Enforces public README localization structure, terminology, literals, and synchronization hashes.
- `redeven:scripts/okf/check_source_integrity.sh:1` - Validates the maintained OKF corpus.

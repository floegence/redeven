---
type: Release Contract
title: CI and release gates
description: Redeven release confidence comes from shell checks, OKF validation, UI checks, Runtime Service compatibility, assets, Go tests, and lint.
tags: [release, ci, quality, okf]
timestamp: 2026-06-18T00:00:00Z
---

Redeven keeps CI and local release checks aligned around source validation and generated asset determinism. OKF is part of that gate, not an optional documentation artifact.

# Mechanism

CI has a dedicated OKF bundle check that validates source integrity and verifies checked-in dist files. The main check installs Go, Node, corepack, golangci-lint, gitleaks, and ripgrep, then runs shell syntax checks, third-party notice validation, open-source hygiene, release note generator tests, Runtime Service compatibility checks, the ReDevPlugin integration readiness gate, Gateway protocol contract checks, Flower protocol checks, Flower UI behavior contracts, UI lint, Desktop checks, embedded asset builds, Go tests, and golangci-lint. Release tags run the compatibility contract check and Gateway protocol contract check before building assets and packaging binaries.

ReDevPlugin consumption is a published dependency upgrade gate, not a source
sync. A Redeven change that integrates or upgrades ReDevPlugin must update the
released Go module, npm packages, signed runtime artifact reference,
schema/contract hashes, compatibility manifest inputs, and verification scripts
together. Local checks must prove the build does not depend on `../redevplugin`,
`go.work`, `replace`, local npm links, copied contracts, or copied runtime
binaries. The current dependency boundary script enforces the no-local-wiring
baseline before any ReDevPlugin package is consumed. The release artifact
verifier is the Redeven-side consumer gate for downloaded ReDevPlugin GitHub
Release assets: it checks outer `SHA256SUMS`, `.sig`/`.bundle` evidence,
keyless cosign signatures when not explicitly skipped for fixtures, release-mode
stress counters, each tarball's internal `release-manifest.json`, internal
`SHA256SUMS`, `compatibility.json`, `THIRD_PARTY_NOTICES.md`, and runtime binary
presence. CI runs the verifier's self-test so the positive fixture passes and a
tampered stress summary is rejected before a real ReDevPlugin artifact is wired
into the release pipeline. When the verifier is used with `--write-marker`, it
emits a machine-readable verification marker that records the checked checksum
file, stress summary, runtime tarball hashes, runtime binary hashes, and
ReDevPlugin third-party notice hashes extracted from those verified tarballs. The
consumption gate scans release staging directories and Desktop bundle
directories for ReDevPlugin payloads and fails if they appear without that
marker. It also binds the marker to the staged payloads: direct ReDevPlugin
tarballs must match marker tarball checksums, direct runtime binaries must match
marker runtime hashes and sit next to matching
`REDEVPLUGIN_THIRD_PARTY_NOTICES.md`, embedded runtime binaries inside Redeven
tarballs must match marker runtime hashes and be packaged with matching
`REDEVPLUGIN_THIRD_PARTY_NOTICES.md`, and staged stress summaries must match the
marker stress checksum. Release automation runs the gate before final checksums
are generated, and the Desktop bundled-runtime preparation runs it before
electron-builder can package the bundle resources. The release artifact staging
helper is the explicit handoff path from a published ReDevPlugin artifact set
into Redeven staging directories: it downloads a GitHub Release tag or copies a
supplied artifact directory, invokes the verifier with marker output, validates
the staged root with the consumption gate, and can extract a target
`redevplugin-runtime` binary together with the copied marker and
`REDEVPLUGIN_THIRD_PARTY_NOTICES.md` so downstream release and Desktop bundle
roots remain directly scannable. Its CI self-test uses fixture release assets
and verifies that missing signature evidence fails, keeping the staging flow
executable before a real ReDevPlugin version is selected. Release packaging and
Desktop packaging now call that staging path only when explicit ReDevPlugin
release inputs are configured. Release tarball builds use
`REDEVEN_RELEASE_REDEVPLUGIN_VERSION` to download and stage a target runtime into
the Redeven tarball together with the verifier marker and ReDevPlugin
third-party notices, then upload the marker as hidden package evidence so the
final release job can scan embedded runtimes before checksums are generated. The
helper still accepts a supplied artifact directory for local fixture and
preflight checks, but the GitHub release workflow selects ReDevPlugin by
published version only. Desktop bundling uses the same selected version through
`REDEVEN_DESKTOP_REDEVPLUGIN_VERSION` and stages the runtime plus notices into
`.bundle/<goos>-<goarch>` before electron-builder packaging. With no selected
published version, both paths remain no-op and do not consume local source.

The ReDevPlugin integration readiness gate is the current pre-release
integration entrypoint. It runs the no-local-wiring boundary guard, release
artifact verifier self-test, consumption gate self-test, artifact staging
self-test, the existing AppServer and Local UI plugin-origin isolation matrix,
and the Redeven-owned Containers capability adapter and fixture contract tests.
This keeps the current host boundary, published-artifact handoff, route
isolation, and business-capability contract executable in one focused CI step.
The route matrix also reserves `/_redeven_plugin/*` and requires it to fail
closed until released ReDevPlugin handlers are actually wired, avoiding
accidental fallback to Env App, codespace, port-forward, Local UI Env route, or
local access-gate surfaces. AppServer separately reserves
`/_redeven_proxy/api/plugins` and `/_redeven_proxy/api/plugins/*` as future
plugin management API paths and requires Env App callers to receive flat JSON
404 responses until released ReDevPlugin handlers own the API surface. Local UI
also verifies locked proxy callers receive the same flat JSON 404 for that
reserved API namespace instead of a Local UI access-gate response. The AppServer
and Local UI portions cover the namespace root, trailing slash, bootstrap,
asset, stream, and CSP report paths across missing, Env App, codespace,
port-forward, plugin, and unknown origins.
Once released ReDevPlugin integration code exists, the same focused gate must
expand to cover the mounted route allow matrix, released-contract hash
verification, session adapter mapping, Env App and Workbench surface smoke,
Flower-generated minimal fixture flow, and concrete business capability
adapters under the real released Host adapters.

# Boundaries

Checked-in generated OKF dist files must match source. Release automation should collect `okf/dist` verification files from the current tree, not from removed `internal/okf` or knowledge paths. Gateway protocol drift must fail before Gateway binaries are packaged, because `spec/openapi/gateway-v1.yaml` is the active source contract for the Gateway HTTP API.

Unreleased ReDevPlugin behavior is not a valid Redeven integration target.
Feature branches may explore adapters against parallel upstream work, but
committed Redeven code and release validation must consume published
ReDevPlugin artifacts only.

# Citations

[1] redeven:.github/workflows/ci-check.yml:14 - CI defines a dedicated OKF bundle check job.
[2] redeven:.github/workflows/ci-check.yml:26 - OKF source integrity is checked in CI.
[3] redeven:.github/workflows/ci-check.yml:29 - OKF dist verification is checked in CI.
[4] redeven:.github/workflows/ci-check.yml:55 - CI runs shell script syntax checks across release and validation scripts.
[5] redeven:.github/workflows/ci-check.yml:92 - Open-source hygiene runs with `--all`.
[6] redeven:.github/workflows/ci-check.yml:98 - Runtime compatibility contract source checks run in CI.
[7] redeven:.github/workflows/ci-check.yml:105 - CI runs the Gateway protocol contract guard.
[8] redeven:.github/workflows/ci-check.yml:111 - CI runs the Flower UI behavior contract script.
[9] redeven:scripts/check_flower_ui.sh:16 - The local Flower UI gate runs stop/send interaction, shared timeline projection, and markdown readability tests.
[10] redeven:.github/workflows/ci-check.yml:120 - Embedded assets are built before Go tests and lint.
[11] redeven:.github/workflows/release.yml:48 - Release tags validate the runtime compatibility contract for the tag.
[12] redeven:.github/workflows/release.yml:51 - Release tags validate the Gateway protocol contract before packaging.
[13] redeven:.github/workflows/release.yml:54 - Release tags build embedded assets before packaging.
[14] redeven:AGENTS.md:689 - Repository local quality gates include OKF integrity, dist verification, assets, Go tests, and golangci-lint.
[15] redeven:scripts/check_gateway_protocol_contract.sh:9 - The local script executes the focused Gateway OpenAPI and naming-boundary tests.
[16] redeven:AGENTS.md:495 - ReDevPlugin upgrades are dependency changes that update released artifacts together.
[17] redeven:AGENTS.md:501 - ReDevPlugin upgrade review must identify released versions, adapters, surfaces, capabilities, and local checks.
[18] redeven:AGENTS.md:513 - Redeven local checks must prove integration does not depend on local ReDevPlugin wiring or copied artifacts.
[19] redeven:scripts/check_redevplugin_dependency_boundary.sh:1 - The local boundary script rejects Go workspaces, local ReDevPlugin wiring, and copied platform-core paths.
[20] redeven:scripts/check_redevplugin_release_artifacts.sh:6 - The release artifact verifier supports real artifact directories, marker output, and a CI self-test mode.
[21] redeven:scripts/check_redevplugin_release_artifacts.sh:10 - The verifier checks outer checksums, signatures, release stress counters, tarball manifests, compatibility metadata, third-party notices, and runtime binary presence.
[22] redeven:scripts/check_redevplugin_consumption_gate.sh:6 - The consumption gate scans release staging and Desktop bundle roots for ReDevPlugin payloads without verifier markers.
[23] redeven:.github/workflows/release.yml:293 - Release automation validates the ReDevPlugin consumption gate before generating final checksums.
[24] redeven:scripts/build_desktop_bundled_runtime.sh:188 - Desktop bundled-runtime preparation runs the ReDevPlugin consumption gate before packaging.
[25] redeven:.github/workflows/ci-check.yml:106 - CI runs the ReDevPlugin integration readiness gate before protocol and UI checks.
[26] redeven:scripts/check_plugin_integration.sh:44 - The readiness gate starts with the published dependency boundary guard.
[27] redeven:scripts/check_plugin_integration.sh:47 - The readiness gate runs release artifact verifier, consumption gate, and artifact staging fixtures.
[28] redeven:scripts/check_plugin_integration.sh:56 - The readiness gate runs the AppServer and Local UI plugin-origin isolation matrix.
[29] redeven:internal/codeapp/appserver/server_test.go:691 - Tests bind the reserved plugin management API namespace to AppServer flat JSON 404 responses.
[30] redeven:internal/localui/localui_test.go:285 - Tests bind the reserved plugin management API namespace to Local UI flat JSON 404 responses without access-gate interception.
[31] redeven:scripts/check_plugin_integration.sh:64 - The readiness gate runs the Containers capability adapter and fixture contract tests.
[32] redeven:scripts/stage_redevplugin_release_artifacts.sh:14 - The staging script downloads or copies ReDevPlugin release artifacts, verifies them, writes a marker, and validates consumption.
[33] redeven:.github/workflows/release.yml:93 - Release tarball builds stage a selected ReDevPlugin runtime only when explicit release inputs are configured.
[34] redeven:.github/workflows/release.yml:113 - Release tarballs include the staged ReDevPlugin runtime, third-party notices, and verifier marker when present.
[35] redeven:scripts/build_desktop_bundled_runtime.sh:113 - Desktop bundle preparation has an env-gated ReDevPlugin runtime staging path.
[36] redeven:.github/workflows/release.yml:241 - Desktop release packaging passes the selected ReDevPlugin version into bundled-runtime preparation.
[37] redeven:.githooks/pre-commit:8 - The local pre-commit hook runs the ReDevPlugin integration readiness gate before Gateway and heavyweight local checks.

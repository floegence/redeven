---
type: Release Contract
title: CI and release gates
description: Redeven release confidence comes from shell checks, OKF validation, UI checks, Runtime Service compatibility, assets, Go tests, and lint.
tags: [release, ci, quality, okf]
timestamp: 2026-07-05T00:00:00Z
---

Redeven keeps CI and local release checks aligned around source validation and generated asset determinism. OKF is part of that gate, not an optional documentation artifact.

# Mechanism

CI has a dedicated OKF bundle check that validates source integrity and verifies checked-in dist files. The main check installs Go, Node, corepack, golangci-lint, gitleaks, and ripgrep, then runs shell syntax checks, third-party notice validation, open-source hygiene, release note generator tests, Runtime Service compatibility checks, embedded asset builds, the ReDevPlugin integration gate, Gateway protocol contract checks, Flower protocol checks, Flower UI behavior contracts, UI lint, Desktop checks, Go tests, and golangci-lint. Embedded asset builds intentionally precede focused Go gates that import Env App or Code App embed packages, because fresh checkouts do not contain ignored UI `dist/` directories. Release tags run the compatibility contract check and Gateway protocol contract check before building assets and packaging binaries.

ReDevPlugin consumption is a published dependency upgrade gate, not a source
sync. A Redeven change that integrates or upgrades ReDevPlugin must update the
released Go module, npm packages when UI surfaces are added, signed runtime
artifact references, schema/contract hashes, compatibility manifest inputs, and
verification scripts together. Local checks must prove the build does not
depend on `../redevplugin`, `go.work`, `replace`, local npm links, copied
contracts, or copied runtime binaries. The dependency boundary script enforces
that no-local-wiring baseline now that Redeven imports the published
`github.com/floegence/redevplugin v0.1.1` Go module. The release artifact
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
compatibility manifest is the release-time source of truth for ReDevPlugin
contract hashes, including token/ticket and Rust IPC schemas that define runtime
lease audience, method/effect/execution, descriptor hash, limit, signature, and
audit-adjacent metadata. Redeven must consume those released hashes as a unit
with the Go/npm/runtime versions rather than copying draft schemas or accepting a
runtime artifact whose lease contract does not match the imported Host library.
The consumption gate scans release staging directories and Desktop bundle
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

The ReDevPlugin integration gate runs the no-local-wiring boundary guard,
release artifact verifier self-test, consumption gate self-test, artifact
staging self-test, AppServer and Local UI plugin-origin isolation and
delegation tests, ReDevPlugin session/security/runtime adapter tests, and the
Redeven-owned Containers capability adapter and fixture contract tests. This
keeps the host boundary, published-artifact handoff, route isolation, released
handler mounting, and business-capability contract executable in one focused CI
step. Before the route matrix runs, the gate verifies that ignored Env App and
Code App embedded asset directories already exist; CI and the local pre-commit
hook build those assets first so fresh checkouts do not fail with low-level
`go:embed` path errors.

Env App plugin entry changes are covered by focused Vitest tests before the
general UI gates. The plugin projection tests bind official catalog plus
matching installed registry merging, exclusion of non-official installed
records, panel tile ordering, lifecycle action selection, revoked/disabled
catalog behavior, and update bucketing. The plugin API tests bind the UI wrapper
to `/_redeven_proxy/api/plugins*` and snake_case lifecycle bodies without URL,
file, unsigned local, or developer install helpers. Plugin Panel and Plugin
Center component tests bind the app-grid entry, pointer cursor affordance,
outside-click ordering, dedicated management shell, local search, details
selection, official-only management copy, disabled management actions for users
without management authority, and disabled official install state when host
distribution install API is required. They also bind surface Open as disabled
until Redeven consumes a released ReDevPlugin surface host. Projection and
component tests bind attention-needed plugin state to details routing, while
Shell integration tests bind the panel `Plugin Center` tile to the dedicated
center view without entering Runtime Settings, disabled plugin tiles to matching
Plugin Center details, and surface-host-not-ready enabled tiles to the Plugin
Center details view with Open still disabled instead of opening a fake sandbox
iframe. Settings structure tests bind Plugin Center's absence from Runtime
Settings navigation.

The route matrix covers both disabled-handler reservations and enabled-handler
delegation. Without a plugin platform handler, `/_redeven_plugin/*` remains
404-only and cannot fall through to Env App, codespace, port-forward, Local UI
Env route, or local access-gate surfaces; `/_redeven_proxy/api/plugins*` returns
AppServer flat JSON 404 for Env App callers without a plugin-owned
`error_code`. With the handler enabled, AppServer delegates
`/_redeven_proxy/api/plugins*` only for Env App origins after rewriting to
`/_redevplugin/api/plugins*`, and delegates `/_redeven_plugin*` only for
plugin sandbox origins after rewriting to `/_redevplugin*`. Local UI verifies
that enabled plugin management requests use the normal local access gate before
delegation. The AppServer and Local UI portions cover the namespace root,
trailing slash, bootstrap, asset, stream, and CSP report paths across missing,
Env App, codespace, port-forward, plugin, and unknown origins. Env App and
Workbench surface smoke plus Flower-generated minimal fixture flow remain
future product-surface gates; they are not part of this integration slice.

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
[6] redeven:.github/workflows/ci-check.yml:103 - Runtime compatibility contract source checks run in CI.
[7] redeven:.github/workflows/ci-check.yml:106 - Embedded assets are built before focused Go gates that import UI embed packages.
[8] redeven:.github/workflows/ci-check.yml:112 - CI runs the Gateway protocol contract guard.
[9] redeven:.github/workflows/ci-check.yml:118 - CI runs the Flower UI behavior contract script.
[10] redeven:scripts/check_flower_ui.sh:16 - The local Flower UI gate runs stop/send interaction, shared timeline projection, and markdown readability tests.
[11] redeven:.github/workflows/ci-check.yml:127 - Go tests run after embedded assets exist in the checkout.
[12] redeven:.github/workflows/release.yml:48 - Release tags validate the runtime compatibility contract for the tag.
[13] redeven:.github/workflows/release.yml:51 - Release tags validate the Gateway protocol contract before packaging.
[14] redeven:.github/workflows/release.yml:54 - Release tags build embedded assets before packaging.
[15] redeven:AGENTS.md:689 - Repository local quality gates include OKF integrity, dist verification, assets, Go tests, and golangci-lint.
[16] redeven:scripts/check_gateway_protocol_contract.sh:9 - The local script executes the focused Gateway OpenAPI and naming-boundary tests.
[17] redeven:AGENTS.md:495 - ReDevPlugin upgrades are dependency changes that update released artifacts together.
[18] redeven:AGENTS.md:501 - ReDevPlugin upgrade review must identify released versions, adapters, surfaces, capabilities, and local checks.
[19] redeven:AGENTS.md:513 - Redeven local checks must prove integration does not depend on local ReDevPlugin wiring or copied artifacts.
[20] redeven:scripts/check_redevplugin_dependency_boundary.sh:1 - The local boundary script rejects Go workspaces, local ReDevPlugin wiring, and copied platform-core paths.
[21] redeven:scripts/check_redevplugin_release_artifacts.sh:6 - The release artifact verifier supports real artifact directories, marker output, and a CI self-test mode.
[22] redeven:scripts/check_redevplugin_release_artifacts.sh:10 - The verifier checks outer checksums, signatures, release stress counters, tarball manifests, compatibility metadata, third-party notices, and runtime binary presence.
[23] redeven:scripts/check_redevplugin_consumption_gate.sh:6 - The consumption gate scans release staging and Desktop bundle roots for ReDevPlugin payloads without verifier markers.
[24] redeven:.github/workflows/release.yml:293 - Release automation validates the ReDevPlugin consumption gate before generating final checksums.
[25] redeven:scripts/build_desktop_bundled_runtime.sh:188 - Desktop bundled-runtime preparation runs the ReDevPlugin consumption gate before packaging.
[26] redeven:.github/workflows/ci-check.yml:109 - CI runs the ReDevPlugin integration gate after embedded assets are generated.
[27] redeven:scripts/check_plugin_integration.sh:62 - The integration gate starts with the published dependency boundary guard.
[28] redeven:scripts/check_plugin_integration.sh:65 - The integration gate runs release artifact verifier, consumption gate, and artifact staging fixtures.
[29] redeven:scripts/check_plugin_integration.sh:44 - The integration gate explicitly checks for embedded UI asset directories before running Go embed tests.
[30] redeven:scripts/check_plugin_integration.sh:74 - The integration gate runs AppServer and Local UI plugin route isolation and delegation tests.
[31] redeven:internal/codeapp/appserver/server_test.go:691 - Tests bind the no-handler plugin management API namespace to AppServer flat JSON 404 responses.
[32] redeven:internal/codeapp/appserver/server_test.go:733 - Tests bind Env App management delegation to the mounted plugin platform handler.
[33] redeven:internal/localui/localui_test.go:348 - Tests bind enabled plugin management requests to the normal Local UI access gate.
[34] redeven:scripts/stage_redevplugin_release_artifacts.sh:14 - The staging script downloads or copies ReDevPlugin release artifacts, verifies them, writes a marker, and validates consumption.
[35] redeven:.github/workflows/release.yml:93 - Release tarball builds stage a selected ReDevPlugin runtime only when explicit release inputs are configured.
[36] redeven:.github/workflows/release.yml:113 - Release tarballs include the staged ReDevPlugin runtime, third-party notices, and verifier marker when present.
[37] redeven:scripts/build_desktop_bundled_runtime.sh:113 - Desktop bundle preparation has an env-gated ReDevPlugin runtime staging path.
[38] redeven:.github/workflows/release.yml:241 - Desktop release packaging passes the selected ReDevPlugin version into bundled-runtime preparation.
[39] redeven:.githooks/pre-commit:8 - The local pre-commit hook builds embedded assets before running the ReDevPlugin integration gate.
[40] redeven:AGENTS.md:263 - Redeven consumes released OpenAPI, token/ticket, Rust IPC, WASM ABI, and classifier contract hashes.
[41] redeven:AGENTS.md:503 - ReDevPlugin upgrade review must identify released Go, npm, runtime, schema, and contract hash versions.
[42] redeven:scripts/check_plugin_integration.sh:85 - The integration gate runs ReDevPlugin session, security, runtime, and route adapter tests.
[43] redeven:internal/redevpluginintegration/adapters_test.go:17 - Adapter tests bind session projection, policy decisions, CSRF validation, trust downgrade, runtime fail-closed behavior, and durable state.
[44] redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.test.ts:1 - Plugin projection tests cover official catalog merging and panel/center bucketing.
[45] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.test.ts:1 - Plugin API tests cover Redeven proxy paths and snake_case lifecycle request bodies.
[46] redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.test.tsx:1 - Plugin Panel tests cover first-tile Plugin Center behavior and interactive cursor affordance.
[47] redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.test.tsx:88 - Plugin Center tests cover the dedicated shell, official-only rendering, and disabled host distribution install state.
[48] redeven:internal/envapp/ui_src/src/ui/pages/settings/settingsStructure.plugins.test.ts:8 - Settings structure tests bind Plugin Center's absence from Runtime Settings.
[49] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:761 - EnvAppShell tests bind the Plugins panel to the dedicated Plugin Center view.

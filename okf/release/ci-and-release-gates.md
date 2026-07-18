---
type: Release Contract
title: CI and release gates
description: Redeven release confidence comes from README localization checks, shell checks, OKF validation, UI checks, ReDevPlugin integration gates, assets, Go tests, and lint.
tags: [release, ci, quality, okf]
timestamp: 2026-07-17T00:00:00Z
---
# Summary

Redeven keeps CI and local release checks aligned around source validation,
README localization parity, generated asset determinism, ReDevPlugin dependency
boundaries, UI behavior, embedded assets, Go tests, and lint. OKF is part of
that gate, not optional documentation.

# Contract

## Mechanism

CI has a dedicated OKF bundle check that validates source integrity and verifies
checked-in dist files. The main check installs Go, Node, corepack,
golangci-lint, gitleaks, and ripgrep, then runs the README localization contract,
shell syntax checks, third-party notice validation, open-source hygiene, release
note generator tests, Runtime Service compatibility checks, embedded asset
builds, the ReDevPlugin integration gate, Gateway protocol contract checks, the
Floret dependency boundary guard, Flower protocol checks, Flower UI behavior
contracts, UI lint, Desktop checks, Go tests, and golangci-lint. Embedded asset
builds intentionally precede focused Go gates that import Env App or Code App
embed packages because fresh checkouts do not contain ignored UI `dist/`
directories. Before the Flower UI gate, CI installs the lockfile-selected
Playwright Chromium runtime and its Linux dependencies so the committed browser
contract runs on a fresh GitHub runner instead of depending on a pre-populated
browser cache.

Local validation is staged to keep iteration fast without weakening integration
evidence. Feature work uses focused checks while implementation, reviews,
generated artifacts, or further upstream synchronization are still pending.
Pre-commit is deliberately limited to staged diff validation, the README
localization contract, and staged open-source hygiene. Heavy product and
repository coverage is owned by the remote-main pre-push path instead of every
feature commit.

When local `main` is pushed, the pre-push hook uses the remote handshake's
authoritative main commit and the proposed local commit as the validation
boundary. It rejects pushes that do not originate from the checked-out local
`main`, are not fast-forwards, or contain merge commits in the unpublished
range. Only then does it invoke the canonical final integration script for that
exact base and tip. This keeps full Desktop Vitest coverage, Docker Runtime E2E,
asset builds, repository-wide Go checks, and the remaining local integration
contracts off routine commits without making them optional before main moves.
The local final gate runs Go package tests serially with caching disabled and
before heavier UI stages. This preserves fresh test evidence while preventing
wall-clock-sensitive PTY integration tests from competing with other Go package
processes on developer workstations.

The canonical English `README.md` and every product-supported
`README.<locale>.md` are bound by `assets/readme/locales.json`. The lightweight
Node contract verifies locale order, language navigation, section anchors,
heading and link parity, local targets, executable command literals, protected
terms, fixed English domain-term forms, Traditional Chinese character rules, content hashes, and the repository
Markdown allowlist. Desktop and Env App locale tests independently bind the
manifest to their language switchers. Feature work may carry translations with
`pending_subagent_review`, but the CI invocation uses `--require-reviewed`, so
no translation can enter `main` without current source/content hashes and an
independent locale-review subagent approval recorded in the manifest.

ReDevPlugin consumption is a published dependency gate, not a source sync. The
dependency boundary script rejects `../redevplugin`, `go.work`, Go `replace`,
local npm links, copied contracts, and copied runtime binaries. The release
artifact verifier and consumption gate remain the path for staging published
ReDevPlugin runtime payloads into Redeven release and Desktop packages.

Floret consumption follows the same published-dependency discipline for Flower
runtime integration. The Floret boundary guard rejects `../floret`, `go.work`,
Go `replace`, imports of Floret internal packages, and direct references to
Floret-owned storage schema tables or columns. Redeven may choose the Floret
store file path and pass it to `runtime.OpenSQLiteStore`, but it must not query,
patch, or shadow Floret's durable ledger.

The ReDevPlugin integration gate runs the no-local-wiring boundary guard,
release artifact verifier self-test, consumption gate self-test, artifact
staging self-test, AppServer and Local UI plugin-origin isolation/delegation
tests, ReDevPlugin session/security/runtime adapter tests, official package
trust tests, and the Redeven-owned Containers capability adapter and fixture
contract tests. Before route matrix Go tests run, the gate verifies that ignored
Env App and Code App embedded asset directories already exist.

Env App plugin entry changes are covered by focused Vitest tests before the
general UI gate. The plugin projection tests bind official catalog plus matching
installed registry merging, exclusion of non-official installed records, panel
tile ordering, lifecycle action selection, revoked/disabled catalog behavior,
and update bucketing. The plugin API tests bind the UI wrapper to
`/_redeven_proxy/api/plugins*`, snake_case lifecycle bodies, official bundled
install/update through `package_base64 + trust_state=bundled`, and the absence
of URL, file, unsigned local, or developer install helpers.

The built Env App renderer smoke is the production exposure gate. Its default
expectation requires the Activity Bar Plugin entry, Plugin Panel, Plugin Center,
and Plugin Surface to be absent and observes that startup issues no plugin API
request. The same smoke can opt into a visible expectation for an explicitly
flagged development build, click the Plugin entry, and require the Plugin Center
tile to render. Release automation uses only the default hidden expectation.

Plugin Panel and Plugin Center component tests bind the app-grid entry,
pointer cursor affordance, outside-click ordering, dedicated management shell,
local search, details selection, official-only management copy, management
action disabling for users without management authority, official install,
update, enable, disable, uninstall, and enabled-plugin Open behavior. Settings
structure tests bind Plugin Center's absence from Runtime Settings navigation.

Shell integration tests run with the development build feature enabled and bind
the panel `Plugin Center` tile to the dedicated Activity main-surface view
without entering Runtime Settings or rendering a floating overlay. Disabled or
attention-needed plugin tiles route to matching Plugin Center details. Enabled
plugin tiles call the ReDevPlugin surface open lifecycle API and render the
internal `plugin-surface` Activity with `PluginSurfaceFrame`. Closing Plugin
Center or Plugin Surface returns to the last normal Activity surface.

`PluginSurfaceFrame` tests bind asset bootstrap, iframe asset URL construction,
published `PluginSurfaceHost` mounting, SDK platform-path rewriting to
`/_redeven_proxy/api/plugins*`, lifecycle disposal, and error presentation.
The reusable bridge handshake, bridge-token request, RPC forwarding,
confirmation request handling, and stream helpers remain covered by the
published `@floegence/redevplugin-ui` package instead of being copied into
Redeven tests.

Official plugin repository gates cover the Containers plugin source. Its tests
bind the manifest method set, Docker/Podman engine enum, canonical
`container_id` response fields, dangerous confirmation hash fields, stream URL
shape, and the absence of wildcard `postMessage` or direct internal Redeven
routes. Its package gate builds a deterministic unsigned `.redevplugin` package
when no signing key is present and emits release metadata used by Redeven's
bundled package allowlist.

The route matrix covers both disabled-handler reservations and enabled-handler
delegation. Without a plugin platform handler, `/_redeven_plugin/*` remains
404-only and cannot fall through to Env App, codespace, port-forward, Local UI
Env route, or local access-gate surfaces. With the handler enabled, AppServer
delegates `/_redeven_proxy/api/plugins*` only for Env App origins and delegates
`/_redeven_plugin*` only for plugin sandbox origins after rewriting to
ReDevPlugin internal paths. Local UI verifies that enabled plugin management
requests use the normal local access gate before delegation.

# Boundaries

Checked-in generated OKF dist files must match source. Release automation
should collect `okf/dist` verification files from the current tree, not from
removed `internal/okf` or knowledge paths. Gateway protocol drift must fail
before Gateway binaries are packaged because `spec/openapi/gateway-v1.yaml` is
the active source contract for the Gateway HTTP API.

Localized README files are public product documentation, not an alternate
knowledge corpus. English remains canonical, localized files cannot introduce
locale-only product or architecture claims, and the exact machine-consumed
`SKILL.md` exception declared by the README manifest does not permit general
Markdown documentation outside OKF.

Unreleased ReDevPlugin behavior is not a valid Redeven integration target.
Feature branches may explore adapters against parallel upstream work, but
committed Redeven code and release validation must consume published
ReDevPlugin artifacts only. The current `PluginSurfaceFrame` is constrained as
Redeven product placement and route adaptation around the published
`@floegence/redevplugin-ui` surface host, not a second reusable plugin UI
platform.

Unreleased Floret behavior is likewise not a valid Redeven integration target.
Flower lifecycle fixes that belong to Floret must ship as a published
`github.com/floegence/floret` release before Redeven consumes them.

A full local quality gate is integration evidence for one exact remote-base and
local-tip pair, not a background check to repeat after every intermediate edit
or sync. Focused checks provide iteration feedback. A stale or divergent remote
main is rejected before heavy checks start; a changed candidate tip receives a
new final gate because evidence from another commit does not transfer.

# Evidence

- `redeven:.github/workflows/ci-check.yml:14` - CI defines a dedicated OKF bundle check job.
- `redeven:AGENTS.md:778` - Repository local quality gates separate focused iteration, fast pre-commit checks, and the final main pre-push gate.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - The local boundary script rejects local ReDevPlugin wiring and copied platform-core paths.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - The Floret boundary script rejects local Floret wiring, internal imports, and direct schema access.
- `redeven:scripts/check_plugin_integration.sh:44` - The integration gate requires embedded UI asset directories before Go embed tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.test.ts:1` - Projection tests cover official catalog merging and tile action decisions.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.test.ts:1` - Plugin API tests cover proxy paths and bundled official install/update bodies.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.test.tsx:1` - Plugin Panel tests cover app-grid entry behavior and pointer affordance.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.test.tsx:1` - Plugin Center tests cover the dedicated shell and lifecycle controls.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.test.tsx:1` - Plugin surface frame tests cover bootstrap, bridge, RPC, and confirmation behavior.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:807` - EnvAppShell tests bind plugin center and plugin surface Activity placement.
- `redeven:internal/codeapp/appserver/server_test.go:733` - AppServer tests bind Env App management delegation to the plugin handler.
- `redeven:scripts/check_readme_localizations.mjs:1` - The README contract validates structure, links, literals, hashes, language quality, and review state.
- `redeven:assets/readme/locales.json:1` - The README locale manifest declares language order, file mappings, review hashes, and the shared visual exception.
- `redeven:.githooks/pre-push:29` - The main pre-push hook validates source ref, checked-out tip, fast-forward ancestry, and linear history before running the full gate.
- `redeven:scripts/check_final_integration.sh:44` - The canonical final integration script binds the complete local gate to explicit base and tip commits and requires a clean worktree.
- `redeven:.githooks/pre-commit:7` - Commit-time validation contains only fast staged checks.

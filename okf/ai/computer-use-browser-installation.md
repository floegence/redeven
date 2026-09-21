---
type: Runtime and Product Contract
title: Optional built-in browser installation
description: Confirm browser acquisition, persist the environment capability switch, and resume through the canonical Flower input request.
tags: [ai, computer-use, browser, installation, desktop]
timestamp: 2026-09-21T00:00:00Z
---
# Summary

Redeven owns one optional Chromium installation per Runtime state directory.
The capability is enabled by default, but discovery, opening settings, enabling,
and agent tool execution never download bytes. Only an authenticated user's
explicit confirmation starts environment download or automatic Desktop acquisition and upload.
Disabling persists, cancels installation, closes managed browser processes and
blocks further use and installation prompts. Installed bytes and website data
remain. Floret owns the input wait and continuation; installer status never
becomes a second conversation lifecycle. Failed verification never publishes a
partial package, and failures offer an explicit retry or alternative source.

# User contract

The shared Browser and desktop dialog opens Browser settings for this environment.
A prominent switch controls permission to use the built-in headless browser.
The installation panel names the exact distribution (Chrome for Testing or
Chromium), its version and the Runtime platform,
shows download and installed sizes, and presents two mutually exclusive sources:

- Environment download fetches the pinned official archive directly on the
  Runtime host after Download and install is pressed.
- Install via Desktop is selected by default when its acquisition bridge exists.
  After confirmation, Desktop automatically obtains the exact Runtime package,
  reuses a verified cache, and transfers the archive. Users never choose a file
  or follow an archive download link. Ordinary web carriers default to environment
  download and explain how to enable Desktop acquisition.

Source selection does not start installation. Progress identifies Desktop cache
checking, Desktop download, upload, host verification and installation. A cache
hit skips network download. The explicit Cancel installation action stops active
acquisition or installation. Closing the panel only unsubscribes: its environment
session continues the operation, and a reopened panel observes the same state.
The disabled browser hides installation choices and retains installed bytes and
website data. Re-enabling reuses a valid installation without downloading.
Installation paths remain secondary details; website-account groups stay separate.

A first managed-browser use without a package returns a canonical `browser_install`
InputRequest with a provenance-bound Activity target reference. The task's setup
action opens this installation panel. A successful installation initiated by that
panel may acknowledge that same pending request once; merely opening a settings
page with an installed browser does not resume work. Closing the panel or changing
the selected interaction retires continuation. An explicitly disabled browser can
continue the task without this capability. Runtime validates installed/enabled
or disabled state again before accepting either answer. No agent installation
tool, shell fallback, automatic re-enable, target substitution, or new Floret API
is introduced. Existing account requirements and private-control boundaries hold.

# Distribution and state

Standard Runtime release suites carry `computer.zip`: official Node, published
Playwright, QuickJS and product helpers, with a closed SHA-256 file inventory.
Native Desktop stages the same thin resources as a directory; managed WSL keeps
the Linux helper ZIP in its exact archive. Neither includes the optional Chromium
archive. Runtime startup validates and extracts the release-suite helper ZIP into
a digest-keyed state directory; extraction requires no network. Public installer
and Desktop SSH activation preserve that companion. Historical published Runtime
suites without this optional file remain installable; this does not synthesize
browser support for those versions. Source-only debugging requires explicit
helpers as before. Runtime compatibility epoch 29 protects the new management
interface from older Desktop clients.

The browser catalog pins the official Playwright CDN URL, version, platform,
architecture, byte size, expanded size, SHA-256 and executable path for every
supported Runtime target. Build staging verifies its Playwright version against
the published installed dependency. Download and upload use the same verifier.
The Runtime never accepts a client-supplied URL, executable path or checksum.
Bounded ZIP extraction rejects traversal, special files, duplicates and escaping
symlinks. macOS framework links stay inside the new directory. A complete verified
package is published under `state/computer/browser/packages/<digest>`; no system
Chrome installation is required. Normal host OS dependencies still apply.

Desktop source-built Runtime upload suites also include `computer.zip`, with
resources staged from that source snapshot for the target platform. Linux
staging may use a different builder platform: its JavaScript/Wasm dependencies
are portable and the target Node archive is checked against official checksums.
Only native target Node binaries are executed on the builder. Darwin staging
retains its matching native Swift builder requirement. The source-build cache
requires the helper archive in its closed inventory, so older incomplete caches
are rebuilt. Runtime helper verification requires extension entrypoints as well
as Node and Playwright. Historical released packages without helpers remain
installable and report their unavailable browser capability through
[Chrome diagnostics](computer-use-chrome-diagnostics.md).

## Archive acquisition ownership

Released `floe-native-apps` v0.2.0 owns the reusable `artifactcache.Acquire` and
`Verify` implementations. Redeven owns the Playwright-bound browser catalog,
consent and placement. Desktop invokes its bundled Runtime's `browser-package`
command with the target package ID, expected SHA-256 and size; the compiled
catalog must match before any cache or network access. Renderer input cannot
select URLs, paths or digests outside that catalog. A mismatch explicitly requires
an update or environment download; it never selects a substitute package.

Original archives are cached by digest in Desktop's private browser-package-cache
directory. Cache reuse rechecks size and digest. Host downloads use the same
upstream acquisition code with temporary cache placement; host upload verification
also uses the upstream verifier before bounded extraction and atomic publication.
Package cache state is independent of Floret conversation and continuation state.
Transport failures do not replay installation requests automatically. A known
unfinished upload is cancelled; uncertain responses require a current host status
read and an explicit retry or cancel action.

The Runtime HTTP installation contract and compatibility epoch remain unchanged.
The new acquisition command belongs to the matching bundled Runtime, and the new
Desktop preload capability is detected directly by both product carriers.

`state/computer/browser/settings.json` owns the versioned enabled preference.
Writes are atomic. Malformed or unknown settings fail closed without rewriting
user state. The installer owns one operation at a time; uploads have opaque IDs,
exact offsets and chunks no larger than 256 KiB. Cancelled or failed operations
remove temporary transfer files; startup clears abandoned transfer staging without
restarting a download. The shared environment-session controller owns active transfer work; panels are
observers. Desktop acquisition jobs are bound to their initiating main frame and
window and environment, with opaque operation IDs and bounded reads. Launcher
browser requests require the original running environment and never start a
stopped Runtime. Environment replacement retires its acquisition jobs. Closing the environment
session or Desktop cancels unfinished acquisition/upload, retaining verified
cache entries. Runtime remains authoritative after upload completion.
No installation automatically restarts following a Runtime restart.

# Evidence

- `redeven:desktop/src/main/runtimePackageCache.ts` - complete source suites and cache admission.
- `redeven:scripts/stage_computer_resources.mjs` - verified native and cross-platform helper staging.
- `redeven:internal/browserinstall/manager.go` - preference, upstream acquisition and atomic package publication.
- `redeven:cmd/redeven/browser_package.go` - fixed catalog acquisition for Desktop.
- `redeven:desktop/src/main/browserPackage.ts` - document-owned process and cached-byte access.
- `redeven:internal/flower_ui/host/browserInstallationController.ts` - environment-owned transfer and panel observation.
- `redeven:internal/browserinstall/catalog.json` - official pinned package identities.
- `redeven:internal/browserinstall/helpers.go` - release-suite helper preparation.
- `redeven:internal/browserinstall/manager_test.go` - consent, cancellation, verification, repair and real browser launch.
- `redeven:internal/ai/computer_browser_installation_integration_test.go` - production Floret wait and validated continuation.
- `redeven:internal/flower_ui/src/FlowerManagedBrowser.tsx` - shared switch and source confirmation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerManagedBrowser.browser.test.tsx` - browser interaction and layout acceptance.
- `redeven:scripts/stage_computer_resources.test.mjs` - relocated thin helpers with explicit browser executable.

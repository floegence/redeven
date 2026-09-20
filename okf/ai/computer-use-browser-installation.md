---
type: Runtime and Product Contract
title: Optional built-in browser installation
description: Confirm browser acquisition, persist the environment capability switch, and resume through the canonical Flower input request.
tags: [ai, computer-use, browser, installation, desktop]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

Redeven owns one optional Chromium installation per Runtime state directory.
The capability is enabled by default, but discovery, opening settings, enabling,
and agent tool execution never download bytes. Only an authenticated user's
explicit confirmation starts environment download or local Desktop ZIP upload.
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
- Desktop upload selects a matching local ZIP, then transfers it only after
  Upload and install is pressed. A link retrieves the exact archive for the
  Runtime's platform, even when Desktop uses a different OS or architecture.
  Both local and remote Desktop environment carriers support this route;
  ordinary web carriers explain that local upload requires Desktop.

Source selection and file selection do not start installation. Progress names
transfer, verification and installation, with cancellation available. A disabled
browser hides installation choices and states that data is retained. Re-enabling
reuses a valid installed package without downloading. Installation paths are
secondary details. Optional website-account groups are separate from installation
and are loaded only when expanded.

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

`state/computer/browser/settings.json` owns the versioned enabled preference.
Writes are atomic. Malformed or unknown settings fail closed without rewriting
user state. The installer owns one operation at a time; uploads have opaque IDs,
exact offsets and chunks no larger than 256 KiB. Cancelled or failed operations
remove temporary transfer files; startup clears abandoned transfer staging without
restarting a download. Closing an uploading Desktop panel cancels its
transfer; an explicitly confirmed environment download may finish after closing.
No installation automatically restarts following a Runtime restart.

# Evidence

- `redeven:internal/browserinstall/manager.go` - preference, explicit acquisition and atomic package publication.
- `redeven:internal/browserinstall/catalog.json` - official pinned package identities.
- `redeven:internal/browserinstall/helpers.go` - release-suite helper preparation.
- `redeven:internal/browserinstall/manager_test.go` - consent, cancellation, verification, repair and real browser launch.
- `redeven:internal/ai/computer_browser_installation_integration_test.go` - production Floret wait and validated continuation.
- `redeven:internal/flower_ui/src/FlowerManagedBrowser.tsx` - shared switch and source confirmation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerManagedBrowser.browser.test.tsx` - browser interaction and layout acceptance.
- `redeven:scripts/stage_computer_resources.test.mjs` - relocated thin helpers with explicit browser executable.

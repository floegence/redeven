---
type: Product Interaction Contract
title: Guided Chrome connection
description: Prepare, install and confirm a same-host browser connection without exposing native-host configuration.
tags: [ai, browser-use, chrome, onboarding]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

Desktop and Env App share one Chrome connection guide. ComputerUseRuntime owns
connections; Floret InputRequired and Respond remain the conversation owners.
The guide is bounded UI observation, not a second execution lifecycle. Users confirm installation and the first connection in Chrome; that profile then restores the same environment connection after restarts. Routine tasks reuse the verified connection without manually selecting a target.

# Contract

The **Connect Chrome** guide opens from canonical conversation assistance. It
prepares the native connection automatically, shows the unpacked-extension
installation steps and offers fixed actions to open Chrome extensions, the
installation folder, or the extension's confirmation page. The package has no
store listing: users enable Developer mode and either use Load unpacked or drag
the entire extension folder onto Chrome's extensions page.
Chrome's extension list, toolbar action and connection page identify the package
as **Redeven Flower**. Staging copies the canonical Redeven app icons at 16, 32,
48 and 128 pixels into the extension bundle. The extension key and registered
installation path remain stable across branding updates.
The stable installation lives under the user's visible `Redeven` home folder.
Its `Flower Browser <identity>` name derives from the Runtime profile root, so
different Runtimes cannot overwrite each other and rebuilding preserves the
registered location. Runtime returns the absolute `extension_path`, exact
`extension_home_path` components and host `platform` from one location mapping.
Staging rejects linked destination directories, validates a complete bundle
before replacement and removes retired assets. Users retain this folder after
installation; it is not a temporary unpacking directory.

Installation and connection appear as two separate steps, with one primary
action at a time. The initial screen opens Chrome extensions or lets an existing
installation skip ahead. The default installation instructions contain two
actions: enable Developer mode, then use Show folder and drag the entire revealed
folder onto Chrome's extensions page. A visible home-to-folder route identifies
the exact directory, with a reminder to retain it after installation.
Load unpacked is a separate, initially collapsed alternative; expanding it
reveals the button instructions, folder selection and host-specific Home shortcut.
It is never presented as a prerequisite for dragging. Both methods end when
Redeven Flower appears in Chrome's extension list, followed by Installed, continue.
Show folder reveals the installation in Finder or opens its visible parent on
Linux; it never selects a folder in Chrome's picker. Hidden-file toggles and
absolute path entry are not required. Copying an absolute path remains optional
inside help. Acknowledging installation advances only
the guide. It does not establish a connection or resume the task. Long paths and
host/browser limitations remain available in collapsed help. Users can return to
installation from the connection step. Conversation assistance uses one short
sentence instead of repeating installation instructions.

A Runtime-generated extension-page fragment supplies the native-host name. It
is configuration, not consent: only the extension's own exact popup path accepts
messages, and the user confirms Connect there. Profile naming is optional. No
raw native-host field or manual inventory refresh is required for the normal
flow. When this Runtime lacks a graphical launch session, the guide exposes a
copyable connection-page link for Chrome on the environment desktop; the
[diagnostics contract](computer-use-chrome-diagnostics.md) owns that recovery. A
bounded two-minute inventory observation exists only while the guide is open;
only the completed Native Messaging handshake can resume the original Floret
interaction. Closing or switching conversations discards delayed results. A
failed check retains installation guidance and exposes a stage-specific recovery
action, without binding a tab or creating another lifecycle.
Connected profiles are reused. Conversation assistance starts at the connection
step when the Runtime has a prepared registration; installation remains available
through Back. First setup and adding another profile start with installation.
Preparation is not proof of Chrome installation or a live connection, and never
resumes a task. Only live, handshaken profiles do so.

After a successful user-confirmed connection, extension-local settings retain
the profile identity, exact native host and automatic-reconnection consent.
Worker startup, Chrome startup and native-port loss restore only that confirmed
transport. A Chrome alarm retries every 30 seconds while Runtime is unavailable.
The popup observes status changes while open. Explicit Disconnect clears consent
and the alarm; restarting Chrome does not undo that choice. Reconnection drains
old requests and bindings without replaying commands, inspecting tabs or granting
new target authority. Existing saved names without confirmed consent do not opt
in. Upgrading from extension 1.0.2 requires a one-time reload and Connect.

Chrome must run on the environment host (macOS or Linux); a remote environment
cannot open Chrome on the client machine. Safari and other browsers are not
supported by this extension connection. Native open actions accept only a fixed
enum, never caller-supplied URLs, paths, arguments or sandbox overrides. Managed
Chromium also launches with its sandbox enabled. Managed profiles are identified
as **Flower dedicated browser**; Default is not the OS default browser.

The shared [environment settings dialog](computer-use-environment-settings.md)
can add another profile while existing profiles remain
connected. Only new verified profile identities complete that guide, returning
to Chrome management without selecting a page or changing conversation grants. Conversation
assistance may reuse already connected profiles and resume immediately. Genuine
profile ambiguity remains the Agent's responsibility through existing discovery.
The extension's optional profile label is user content, not routing authority.

Runtime Service epoch 30 pairs the connection status snapshot and structured
diagnostics with both product carriers. `extension/status` contains live profiles, an optional failure reason
and optional `prepared` presentation hint. Older carriers safely ignore the hint;
new carriers retain installation guidance when it is absent. Native Messaging
uses protocol 7. The first connection remains consent-gated even when the URL
supplies configuration.
No database, Floret API, tool-selection rule or authorization policy changes.

The Runtime hub owns one bounded, non-sensitive handshake failure alongside its
connected profiles. A valid extension hello with an incompatible protocol records
`extension_update_required` and returns a rejection before admitting a profile.
The extension popup shows progress while connecting. An incompatible handshake
replaces the connection form with one Update extension action, opening the exact
extension in Chrome settings. Extension 1.0.4 retains the existing key and
protocol 7; loading the current Runtime folder replaces older protocol 6 code
without clearing user profiles. The shared guide observes that same snapshot and opens the update workflow,
even when an older extension cannot explain its rejection. It never continues a
conversation from an installation acknowledgement. Successful handshake or
explicit setup clears the diagnostic; no failure or pending connection is stored.

Chrome's native-host error is read only during its disconnect callback and mapped
to a closed reason for expired registration, blocked or failed host startup,
unavailable Runtime, or timeout. Raw platform errors and paths do not enter the
popup. The stable staged package records prior setup. Runtime startup uses the
same setup path to restore registration and current assets only when that package
exists; fresh environments do not prepare Chrome automatically. Reopening the
guide or its connection action can also repair registration and package files.
Shutdown removes only the exact owned registration and active socket. A stale
page cannot silently attach to another Runtime, downgrade the protocol or bypass
Chrome consent. Updating an unpacked extension loads the current visible folder
with the same extension key; it does not require clearing browser profiles.

# Boundaries

Installation and connection never grant website access or authorize a tab. The
Agent discovers and selects a target through the existing authorization path
after Respond. A failed or cancelled guide leaves the task paused. Uncertain
tool effects, private pixels and explicit Stop keep their existing boundaries.

# Evidence

The directory-drop path was checked on 2026-09-19 against Chromium's
[drag handler](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/resources/extensions/drag_and_drop_handler.ts):
a dropped directory invokes `loadUnpackedFromDrag` directly, without the Load
unpacked button or native folder picker. Browser tests cover the two guidance
paths and the installed branding. CDP-synthesized drops lack Chrome's native
drop data and are not evidence of real operating-system folder installation.

Chrome labels were checked on 2026-09-18 against Chromium's
[extension messages](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/app/extensions_strings.grdp)
and the `generated_resources_<locale>.xtb` translations under
[chrome/app/resources](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/app/resources/).
The shipped English, German, Spanish, French, Japanese, Korean, Brazilian
Portuguese, Russian, Simplified Chinese and Traditional Chinese catalogs use
the actual Developer mode and Load unpacked labels. Simplified Chinese also
names the earlier label from
[Chromium 120](https://chromium.googlesource.com/chromium/src/+/refs/tags/120.0.6099.109/chrome/app/resources/generated_resources_zh-CN.xtb).
This locale-specific alternate is intentional. Chrome language and version may
differ from Redeven; collapsed help includes the English labels.

- `redeven:internal/ai/computer_extension_onboarding.go` - fixed native destinations and stable package staging.
- `redeven:internal/ai/computer_extension_onboarding_test.go` - destination rejection, sandbox arguments and installation replacement.
- `redeven:internal/flower_ui/src/FlowerChromeConnection.tsx` - bounded connection inventory observation and disposal.
- `redeven:browser-extension/popup.mjs` - automatic configuration and explicit confirmation.
- `redeven:browser-extension/background.mjs` - confirmed transport recovery and explicit disconnect.
- `redeven:internal/envapp/ui_src/scripts/computerExtensionLifecycle.node-test.mjs` - worker restart, unavailable Runtime, alarm recovery and consent persistence.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - first connection, extra profiles, cancellation and retry.
- `redeven:scripts/stage_browser_extension.mjs` - canonical brand assets in the packaged extension.
- `redeven:internal/envapp/ui_src/scripts/computerExtensionInstall.node-test.mjs` - staged icon integrity and installation qualification.
- `redeven:internal/envapp/ui_src/scripts/computerExtension.node-test.mjs` - installed extension branding and isolated browser behavior.
- `redeven:internal/envapp/ui_src/scripts/installChromeExtensionThroughUI.mjs` - visible Chrome installation and the macOS native picker.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopSystemBrowser.mjs` - real product connection, independent task tab, Stage and continuation.
- `redeven:internal/envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs` - sandbox enabled in the actual managed browser process.

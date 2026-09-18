---
type: Product Interaction Contract
title: Guided Chrome connection
description: Prepare, install and confirm a same-host browser connection without exposing native-host configuration.
tags: [ai, browser-use, chrome, onboarding]
timestamp: 2026-09-18T00:00:00Z
---
# Summary

Desktop and Env App share one Chrome connection guide. ComputerUseRuntime owns
connections; Floret InputRequired and Respond remain the conversation owners.
The guide is bounded UI observation, not a second execution lifecycle. Users confirm installation and connection in Chrome; routine tasks reuse the verified connection without manually selecting a target.

# Contract

The **Connect Chrome** guide opens from canonical conversation assistance. It
prepares the native connection automatically, shows the unpacked-extension
installation steps and offers fixed actions to open Chrome extensions, the
installation folder, or the extension's confirmation page. The package has no
store listing: users enable Developer mode and use Load unpacked in Chrome.
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
installation skip ahead. Opening extensions reveals developer mode, the load
button and a visible home-to-folder route. Host-specific Home shortcuts assist
normal picker navigation; hidden-file toggles and absolute path entry are not
required. Show folder reveals the installation in Finder or opens its visible
parent on Linux; it never selects a folder in Chrome's picker. Copying an absolute
path remains optional inside help. Acknowledging installation advances only the
guide. It does not establish a connection or resume the task. Long paths and
host/browser limitations remain available in collapsed help. Users can return to
installation from the connection step. Conversation assistance uses one short
sentence instead of repeating installation instructions.

A Runtime-generated extension-page fragment supplies the native-host name. It
is configuration, not consent: only the extension's own exact popup path accepts
messages, and the user confirms Connect there. Profile naming is optional. No
raw native-host field, manual copy or manual inventory refresh remains. A
bounded two-minute inventory observation exists only while the guide is open;
only the completed Native Messaging handshake can resume the original Floret
interaction. Closing or switching conversations discards delayed results. A
failed check exposes retry, without binding a tab or creating another lifecycle.
Connected profiles are reused; a disconnected profile can reconnect through
step 2 without reinstalling the extension.

Chrome must run on the environment host (macOS or Linux); a remote environment
cannot open Chrome on the client machine. Safari and other browsers are not
supported by this extension connection. Native open actions accept only a fixed
enum, never caller-supplied URLs, paths, arguments or sandbox overrides. Managed
Chromium also launches with its sandbox enabled. Managed profiles are identified
as **Flower managed browser**; Default is not the OS default browser.

Connection management can add another profile while existing profiles remain
connected. Only new verified profile identities complete that guide. Conversation
assistance may reuse already connected profiles and resume immediately. Genuine
profile ambiguity remains the Agent's responsibility through existing discovery.
The extension's optional profile label is user content, not routing authority.

Runtime Service epoch 27 pairs the connection status snapshot with both product
carriers. `extension/status` replaces the removed profile-list route. Native Messaging uses protocol 6. The extension
connection page remains consent-gated even when the URL supplies configuration.
No database, Floret API, tool-selection rule or authorization policy changes.

The Runtime hub owns one bounded, non-sensitive handshake failure alongside its
connected profiles. A valid extension hello with an incompatible protocol records
`extension_update_required` and returns a rejection before admitting a profile.
The shared guide observes that same snapshot and opens the update workflow,
even when an older extension cannot explain its rejection. It never continues a
conversation from an installation acknowledgement. Successful handshake or
explicit setup clears the diagnostic; no failure or pending connection is stored.

Chrome's native-host error is read only during its disconnect callback and mapped
to a closed reason for expired registration, blocked or failed host startup,
unavailable Runtime, or timeout. Raw platform errors and paths do not enter the
popup. Reopening the guide or its connection action uses the same explicit setup
path to repair package files and registration, including after Runtime restart.
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
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - first connection, extra profiles, cancellation and retry.
- `redeven:internal/envapp/ui_src/scripts/installChromeExtensionThroughUI.mjs` - visible Chrome installation and the macOS native picker.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopSystemBrowser.mjs` - real product connection, independent task tab, Stage and continuation.
- `redeven:internal/envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs` - sandbox enabled in the actual managed browser process.

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
The stable installation directory belongs to the Runtime state root, so a new
Runtime build does not change the folder Chrome registered. Staging validates a
complete bundle before replacing it and removes retired assets.

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

Runtime Service epoch 25 requires the fixed setup/open/inventory endpoints in
both product carriers. Native Messaging stays at protocol 5. The extension
connection page remains consent-gated even when the URL supplies configuration.
No database, Floret API, tool-selection rule or authorization policy changes.

# Boundaries

Installation and connection never grant website access or authorize a tab. The
Agent discovers and selects a target through the existing authorization path
after Respond. A failed or cancelled guide leaves the task paused. Uncertain
tool effects, private pixels and explicit Stop keep their existing boundaries.

# Evidence

- `redeven:internal/ai/computer_extension_onboarding.go` - fixed native destinations and stable package staging.
- `redeven:internal/ai/computer_extension_onboarding_test.go` - destination rejection, sandbox arguments and installation replacement.
- `redeven:internal/flower_ui/src/FlowerChromeConnection.tsx` - bounded connection inventory observation and disposal.
- `redeven:browser-extension/popup.mjs` - automatic configuration and explicit confirmation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - first connection, extra profiles, cancellation and retry.
- `redeven:internal/envapp/ui_src/scripts/installChromeExtensionThroughUI.mjs` - visible Chrome installation and the macOS native picker.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopSystemBrowser.mjs` - real product connection, independent task tab, Stage and continuation.
- `redeven:internal/envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs` - sandbox enabled in the actual managed browser process.

---
type: Product Interaction Contract
title: Browser and desktop settings
description: Separate environment capability, Chrome pairing, conversation target selection, and grants in one shared settings surface.
tags: [ai, computer-use, settings, desktop, envapp]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

Redeven owns one Browser and desktop dialog shared by Desktop and Env App.
ComputerUseRuntime supplies current host capability and resource discovery;
existing thread settings own selection and access grants; the Chrome extension
owns confirmed pairing consent. These facts never substitute for one another.
Opening, refreshing, or leaving settings never selects a page, grants access,
starts a task, installs components, or launches a private desktop. Failed reads
remain unknown, and a lost selected object remains unavailable until recovered
or explicitly replaced. Floret remains the sole conversation lifecycle owner.

# Contract

## Overview and navigation

The overview identifies the actual Runtime hostname and platform, then shows the
page or app used by the current conversation and three environment entries:
built-in headless browser, Chrome in this environment, and desktop/applications.
The built-in browser is Chromium packaged with Redeven. It runs headlessly in the
current Runtime environment, needs no separately installed Chrome, and starts
after authorized task selection. Its details use three short facts: browser,
installation, and execution. Saved website data stays separate from system Chrome.
Optional account groups are collapsed by default; the built-in group is localized
as shared website data using its stable ID. Creating a group isolates website
sign-ins without selecting a page or importing system Chrome data.

Chrome management describes live profiles and saved pairing, with one setup guide. Desktop details explain missing OS permission or
components. A global Flower settings entry opens this same dialog; without a
conversation it exposes only environment settings. Opening management always
shows the overview, even when the conversation is waiting for Chrome. Only the
explicit connection-assistance action opens a guide that may resume that request.

The conversation section is the overview's primary action area. An unavailable
previous page is informational: the primary action returns to the conversation,
where Flower can discover and select a suitable resource for the task. Manual
selection is secondary. Closing settings neither submits nor resumes work.
Environment entries use equal-width cards with textual status badges and visible outlined management
buttons aligned along the bottom; narrow surfaces stack the cards. Help and
advanced discovery are secondary navigation, and conversation permissions remain
in the footer. Status color supplements the label and never represents a new
state owner. Shared Floe buttons retain their keyboard and disabled behavior;
product layout uses theme tokens in both light and dark appearances.

Target selection follows the single
[target selection contract](computer-use-target-selection.md). Per-resource grants
are edited on a separate conversation-permissions page. Full access hides
redundant grant controls and never implies installed components or OS permission.
Changing approval mode returns to the existing composer editor; settings do not
create another permission owner or task continuation path.

Closing the dialog or changing conversations retires outstanding UI results and
Chrome guide observation. Read-only carriers may inspect settings; mutation
controls remain disabled. Search, keyboard selection, cancellation, long resource
names, and narrow layouts use published Floe UI primitives. Both carriers provide
complete explicit localized copy.

## Runtime observation and recovery

`GET computer/environment` returns hostname, platform, managed-browser capability,
desktop capability, and the existing live Chrome status snapshot. It requires the
existing authenticated computer-management permission. Managed capability checks
profile metadata and installed entrypoints without starting Chromium. Native
capability probes helper protocol and OS permissions without opening a control
session. Private Linux desktop checks installed dependencies without launching
Xvfb, its window manager, or application processes. Capability is an observation,
not an authorization or a guarantee that subsequent startup cannot fail.

Capability states are `ready`, `on_demand`, `setup_required`, and
`permission_required`; closed reason codes are available in collapsed diagnostics.
An independent missing desktop permission does not hide a usable browser. A failed
status request shows unknown and offers refresh; refresh never repairs a missing
installation or clears a reported failure without new evidence.

No live Chrome profile means no online Chrome was detected. It does not establish
that the user never paired Chrome. Confirmed persistence, manual disconnection,
and automatic reconnection belong to the
[Chrome connection contract](computer-use-browser-connection.md).

`POST computer/candidates` accepts a thread ID and user-entered Chromium debugging
endpoint. Product authorization verifies endpoint/thread ownership first. Runtime
performs bounded read-only tab discovery, captures exact identity, title and URL,
and issues the same expiring opaque candidate references used by normal discovery.
The response preserves the selected identity and current resource occupancy,
deduplicates existing targets, and obeys the shared inventory limit. The UI never
constructs connections from tab metadata. Only explicit selection prepares or
binds a page; discovery failure leaves the old selection intact.

Runtime compatibility epoch 28 is required by the bundled Desktop surface for
these environment and candidate interfaces. Existing Runtime compatibility and
upgrade boundaries apply; no local fallback connection form, durable candidate
store, schema migration, or new Floret API is introduced. Published Floe components
already supply the required UI primitives, so this change is product integration
rather than an upstream platform extension.

# Evidence

- `redeven:internal/flower_ui/src/FlowerComputerConnections.tsx` - shared dialog and staged operations.
- `redeven:internal/flower_ui/host/computerUseAdapter.ts` - one carrier-neutral Runtime adapter.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx` - global entry to the same dialog.
- `redeven:scripts/stage_computer_resources.mjs` - packaged Chromium delivery.
- `redeven:internal/envapp/ui_src/scripts/redevenManagedBrowser.mjs` - headless persistent browser process.
- `redeven:internal/ai/computer_environment.go` - capability observation and authorized advanced discovery.
- `redeven:internal/ai/computer_environment_test.go` - no startup/binding, independent failure, authority and inventory limits.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerDialog.browser.test.tsx` - actual dialog behavior, cancellation, read-only inspection and keyboard layout.
- `redeven:desktop/src/main/runtimeFlowerRoutes.test.ts` - exact Desktop route admission.
- `redeven:internal/runtimeservice/compatibility_contract.json` - paired Runtime/Desktop compatibility window.

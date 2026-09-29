---
type: Architecture Contract
title: Remote browser source ownership
description: Admit native pages once and preserve directory, control and popup privacy boundaries.
tags: [architecture, browser, privacy]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

- Authority: ComputerUseRuntime owns native source identities, grants and target gates; FloeBrowser and Flower share one source debugger adapter.
- Outcome: managed, CDP and extension pages use the same directory and input lifecycle while retaining their source-specific admission rules.
- Invariants: one debugger and one ordered input path exist per page; discovery is not admission; private opener ancestry remains authoritative after intermediate pages close.
- Failure boundary: source overflow or loss retires only affected bindings and never replays input or silently broadens grants.

# Contract

## Website compatibility and browser identity

The environment browser is a persistent, managed headless Chromium process.
It is not equivalent to a newly installed interactive Chrome. Website admission
is decided by the source website and can depend on automation support, source
network reputation, native browser capabilities and existing site state. A
correctly projected click does not establish why a site requested verification
or prove that the verification succeeded.

Preserve the source browser's native identity, cookies and storage. The product
must not infer hardware or platform metadata from a reduced User-Agent, rotate
browser identities, replay an uncertain action or clear a profile to retry a
challenge. Source requests remain in the selected browser; no request, cookie
or challenge token is relayed through a second HTTP client.

The personal browser is the recommended explicitly selected path for interactive
browsing. Its profile and login remain in the original browser. The source dialog
opens the selected personal profile through the [live workspace contract](remote-browser-profile-workspace.md); it never grants Flower input authority. Managed and personal source
capabilities remain distinct. A successful fixture or one public-site visit
does not imply universal CAPTCHA compatibility.

## Personal browser installation and admission

Runtime discovers macOS Google Chrome and Linux Google Chrome, native Chromium
and Snap Chromium through fixed installation adapters. Clients submit an opaque
installation ID, never an executable path. Detection alone neither stages a
connection nor launches the browser. One Runtime hub owns all live profiles;
per-installation Native Messaging endpoints only forward to that hub.
Native and Snap Chromium may coexist. A Snap executable on `PATH` must not hide
a separately installed native browser; Ubuntu's transitional Snap launcher is
not itself another native installation.

Snap extension assets, the private Unix socket and the exact current static Runtime
bridge live under the user's Snap Chromium common data directory. Bridge deployment
verifies the running build's bytes and publishes atomically. Other installations
retain their native host identity and existing protocol. Setup restoration records
failures per installation so one unavailable browser cannot block others. No
browser database is copied, and no second process shares an active personal profile.


Native Messaging protocol 9 carries one ordered native directory stream and
separately bound debugger commands/events. Binding replies distinguish a newly
acquired debugger from a reused owner so cancellation can retire only its own
generation. Connecting a profile or discovering
its tabs does not attach a debugger. Explicit Flower target selection validates
URL/title; a product workspace resolves its already-authorized stable native
identity on demand. Incognito pages cannot enter either path. Internal pages
remain directory entries with an explicit unsupported projection state. The
extension permits only the bound root and its known iframe sessions, rejects
browser-wide debugger attachment, and restricts IO to download streams returned
for that binding.

The Runtime's existing Node source host owns the semantic controller and the
FloeBrowser CDP source adapter together. The extension no longer executes an
independent AI controller. Iframe attachment initializes the same observation
and privacy owners before releasing a paused child. User browsing, Flower
execution and private handback pass through the existing target gate.

A private Unix socket per admitted extension source separates debugger traffic
from the helper's small lifecycle pipe. The admitting caller can cancel a pending
socket handshake immediately; after the handshake the source host owns the
carrier lifetime, so a finished caller cannot disconnect other viewers.
Framed input is limited to 24 MiB,
outbound native-host commands to less than 1 MiB, and pending helper commands to
32 per source. Native delivery has a 32 MiB / 512-message per-source budget and
a shared 64 MiB / 1,024-message budget for unacknowledged traffic. Excess traffic
retires its producing source while preserving the profile carrier and peers.
Credits return only after the source helper consumes a frame. The
Runtime source queue is independently bounded to 64 MiB / 128 frames. Overflow
or carrier loss retires affected authority; no command or tab binding is
replayed. Retirement retains the binding reservation until its exact-generation
detach completes, so delayed cleanup cannot revoke a later selection.

Browser extension setup, status and inventory routes belong directly to the
ComputerUseRuntime and work without an AI provider. The existing extension
installation/connection UI and Flower use the same source setup operations.

The shared FloeBrowser source adapter observes top-document title changes in an
isolated world, independently of DOM and media projection. Runtime reads native
target metadata after that notification and updates admitted directory titles,
including unselected pages. Neither directory discovery nor title observation
starts projection or executes website-provided JavaScript.

## Directory lifetime

Runtime reserves observation registration under the directory lock, releases it while the helper opens the view, then reconciles the latest grants before returning its carrier. Lazy source resolution can acquire the same lock without deadlocking registration. Grant publication drains revoked access but never waits for new page resolution. Projection closure removes execution authority; a personal workspace retains native metadata until Chrome confirms tab removal. Direct source grants retain their existing retirement behavior. A close decision reserves only its target input gate; it must not hold the directory lock while a person answers `beforeunload`. An exact pending directory decision is separate from page input authority.

Closing a view ends its carriers and input authority, not its source browser. Changing selection releases the previous input owner. Hidden navigation may continue in the source, but explicit input retirement drains the controller and its held input before a new controller is admitted.

Popups from a managed source join that source's already-open managed
workspace after Runtime validates their current native identity. A foreground
popup selects only the view that owns input on its opener; other observing
windows and Flower bindings retain their selections. The released source adapter
reports left-click and ordinary keyboard/script popups as foreground, while a
middle-click creates a background tab. Runtime applies that intent only after
admission, using the same directory and selection APIs as explicit tab changes.
Personal profile popups join the native directory without projection or input authority; CDP popups still require explicit external selection. Managed popup visibility inherits
the source owner’s native opener ancestry: private descendants stay visible only
to the private owner, including when an ancestor closes. The same source-owned
privacy predicate redacts managed, CDP and extension inventory before another
workspace or AI discovery can consume it. Chromium's native target identity is
shared across endpoint aliases and extension bindings; a second path cannot
admit another source owner or expose a private page. Extension inventory supplies
native identities and retained opener ancestry, including compacted edges across
closed intermediate pages. CDP discovery refreshes these facts before publishing
its inventory. The graph is bounded to 1,024 native nodes and 128 directory
observers; overflow fails closed without dropping privacy facts. Explicit private handback releases descendant visibility.

The [live personal workspace](remote-browser-profile-workspace.md) owns profile
inventory, lazy projection and native mutations. Advanced CDP workspaces retain
explicit page admission. External closed-page restoration stays disabled at both
the component and Runtime boundaries; no personal page is recreated from a saved URL.

# Boundaries

Discovery is not source admission. Source loss or overflow retires affected bindings without replay or broader grants. Private opener ancestry remains authoritative after intermediate pages close, and each admitted page retains one ordered debugger input path.

# Evidence

- `redeven:internal/browserbridge/installations.go` - Fixed discovery and opaque installation identity.
- `redeven:internal/ai/computer_extension_registration.go` - One hub with installation-specific registration and verified Snap bridge placement.
- `redeven:internal/ai/computer_extension_source.go` - Bounded private source carrier and native binding lifetime.
- `redeven:internal/ai/computer_extension_source_test.go` - Cancelable admission and shared carrier survival after its admitting caller finishes.
- `redeven:browser-extension/background.mjs` - Selected-tab debugger boundary and consumption credits.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.mjs` - Shared semantic/projection ownership across CDP and extension sources.
- `redeven:internal/ai/computer_browser_privacy.go` - Native identity and opener ancestry privacy.
- `redeven:internal/ai/computer_browser_lifecycle.go` - Projection retirement and native identity preservation.
- `redeven:internal/ai/computer_browser_workspace_test.go` - Directory, private descendants and source isolation.
- [FloeBrowser v0.1.27: src/host/session.ts](https://github.com/floegence/floebrowser/blob/v0.1.27/src/host/session.ts) — Directory observation and controller lifecycle.

---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through exact inventory identities, explicit review, SDK-owned surfaces, Activity windows, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Plugin UI is a released ReDevPlugin sandbox surface inside Redeven chrome.
Activity opens multiple stable Shell-root floating windows without replacing the
current page; Workbench opens standard projected `redeven.plugin` widgets using
the released interaction-ownership channel. Plugin Center manages official and
external installed instances by exact `inventoryKey`, exposes explicit permission
controls, and reviews public HTTPS, GitHub Release, or local `.redevplugin`
packages before commit. Redeven owns product navigation, review, geometry,
stacking, and placement; ReDevPlugin owns package admission, iframe bootstrap,
bridge, lifecycle, confirmation, streams, and revocation.

# Contract

## Discovery and exact inventory

The Activity Bar `Plugins` entry opens an app-grid panel without changing the
current normal surface. Plugin Center is a dedicated Activity surface. An
enabled item with a valid launch target and effective required grant opens in
the chosen placement; disabled, unavailable, not-installed, permission-required,
or policy-restricted items open exact management details.

The Shell owns inventory loading, one platform client, shared scope, placement
controllers, and the selected product inventory key. Every catalog or installed
item has a stable `inventoryKey`; Panel tiles, Center rows, detail selection, and
commands carry that exact key. Plugin id is not unique, and instance id alone is
not used to select catalog presentation. This keeps an official catalog entry
and multiple external instances with identical manifest ids independent.

Official Containers catalog projection requires exact publisher, plugin, version,
package, manifest, and entries identity. The current unsigned catalog transaction
creates a generated instance id; exact current content receives catalog copy and
permission grouping, replaces the Discover card, and retains its real unsigned
trust badge and manual update state. A historical version requires the fixed
catalog instance, an explicit catalog-trusted official signing key, no external
provenance, and registry hashes equal to Host-verified hashes. Official-looking
ids without the exact content cannot inherit catalog presentation or update
controls.

Lifecycle commands carry the current management revision. Permission mutations
also carry policy revision and revoke epoch. Unknown mutation outcomes invalidate
affected surfaces and refresh inventory without blind retry. Plugin Center admits
one mutation at a time so rapid clicks cannot submit the same revision twice.

## External package review

Administrators may start installation or update from a compatible public HTTPS
package URL, public GitHub repository Release with optional tag, or local
`.redevplugin` file. The product submits the source and intent to the released
inspection API; it never downloads remote bytes in the browser, parses the
package, chooses trust state, or invents provenance.

The Containers Discover action opens this same dialog with the unsigned catalog
package URL prefilled. The URL is pinned to the immutable commit that contains the
artifact; the dialog still shows the full inspection and requires explicit
confirmation. It never calls the retained `installReleaseRef` path or silently
retries through it when official trust evidence is expired.

Update source entry preserves only reusable public identity. GitHub updates may
prefill the stored public repository URL and resolve a newly eligible Release.
Package-URL updates require the administrator to enter the URL again because
server provenance omits query strings and credentials; upload updates require a
new file selection. The update intent remains bound to the installed plugin
instance and current management revision in every case.

The review stage presents immutable plugin/version identity, source provenance,
package digest, signature assessment, execution approval, update eligibility,
confirmation digest, and complete security summary. Declared permissions,
capability methods, workers, network, storage, secret references, core actions,
intents, and surfaces are shown item by item. Updates mark added, changed, and
removed access and display the complete security-summary SHA-256. The final URL,
redirect chain, and GitHub repository, resolved tag, and asset identity remain
visible as server-produced provenance. A policy-blocked result shows its stable
reason codes instead of collapsing them into an unsigned-package warning.

Invalid, revoked, or policy-blocked assessment disables commit. Absent,
unknown-signer, and temporarily unavailable signatures show a prominent risk
state but may be explicitly confirmed. Commit is unavailable until confirmation,
and the dialog cannot close while commit is in flight. Response-loss query uses
the exact inspection and commit identity. After an unknown or in-progress result,
retry remains query-only across bounded reconciliation timeouts until terminal.
An in-progress update retires its visible slots while reconciliation is pending.
A failed terminal result keeps the installed revision eligible to reopen; a
timeout, abort, or otherwise unresolved in-progress outcome fences that revision
until inventory proves a newer runnable target.
After commit, the plugin is visibly disabled, has no grants, and is manual-update-
only unless verified trust evidence makes it eligible. A refresh failure after
terminal commit does not expose a second commit action. A GitHub update without
an administrator-entered tag inspects the latest eligible Release instead of
silently pinning the tag resolved by the previous inspection.

## Permissions and policy

Plugin Center joins installed records, active grants, generic permission
requirements, and explicit security policy. Official Containers explains
`containers.read`, `containers.execute`, `containers.delete`, and
`containers.images.write`; `containers.read` is required for initial status and
list methods, so its absence blocks surface open with a permission explanation
rather than a Docker connection error.

Generic requirements come from the released Host projection of the active
version's verified capability contracts, not manifest claims. Only an environment
administrator may grant or revoke. An allowlist cap, denied method, active grant,
and effective permission remain separate. Generic permission controls and their
confirmation name the exact permission id. A stale grant remains revocable when
policy blocks its use. Failure reloads inventory, grants, and policy and requires
a new confirmation.

## Activity windows

Each Activity window owns one fresh `PluginSurfaceSlot` and opens it only through
`openSurfaceInSlot`. The SDK Promise is the sandbox load, bridge handshake,
worker readiness, and first-commit boundary. Redeven creates no iframe,
bootstrap, asset session, or bridge.

The Shell maintains the only Activity multi-window registry, exact target
deduplication, activation stack, and geometry persistence. Reopening an existing
Activity target activates its current window; a different target creates another
slot. Desktop windows are movable and resizable in a bounded z-order band. The
band admits nine unique window levels. Opening a tenth distinct target awaits
exact-slot close of the least recently active window; activating a window moves
it out of the eviction position, and a failed close preserves its recovery shell
and rejects the new open instead of creating duplicate z-index ownership. The
same stable DOM becomes a mobile full-screen modal; only the active mobile window
is visible to pointer, keyboard, and accessibility input, while lower windows
receive the released `hidden` lifecycle.

Window close publishes `hidden`, aborts an in-flight open, awaits exact slot
close, then disposes local ownership. Slot close performs released idempotent
single-surface reconciliation when a response is lost. Local iframe disposal is
not revocation evidence, and one uncertain close never revokes sibling windows
or the whole authenticated plugin session.

## Workbench widgets and placement

Workbench uses the normal projected widget type `redeven.plugin`. Its persisted
state contains the exact plugin instance, plugin id, surface id, display name,
and management revision. Restore first resolves that state against current
inventory. A runnable newer revision is persisted through the same controller
before a fresh slot mounts; disabled, removed, permission-blocked, or unresolved
records remain as a visible unavailable placeholder and never open a stale slot.
Duplicate-open detection, activation, revision replacement, removal, and
`closeAll` share the controller and retry failed cleanup instead of forgetting
the target.

The SDK's source/port-bound interaction observations drive Redeven's existing
local wheel, selection, action, activation, focus, and floating-layer policy.
They are presentation input only, not permission or identity evidence. Redeven
does not add an overlay, toggle iframe pointer events, guess focus, synthesize DOM
events, or establish a second MessageChannel.

Placement operations are globally serialized. Moving a target between Activity
and Workbench, replacing its Workbench revision, or removing its widget awaits
successful old-slot close before new widget state is persisted or a new slot is
opened. The target always receives a fresh lease, iframe, and surface instance;
an existing iframe is never moved or adopted.

## Confirmation and teardown

Surface capability confirmations use one abort-aware FIFO product dialog, never
native blocking confirmation. It displays plugin and surface identity, signed
plan summary, target, method, and request hash without secret parameters. Hidden,
retired, or revoked surfaces cannot approve queued work.

Placement moves, explicit window/widget removal, and orderly Shell disposal use
exact-slot close. Disable, update, uninstall, permission/policy, and owner-scope
mutations rely on the released Host revoke followed by SDK scope invalidation or
disposal for committed and unknown outcomes; Redeven does not close an already
disposed slot. Session teardown uses the released session-scope revoke and waits
for the four-hash drain. Local disposal alone is never revocation evidence.
Browser reads retain same-origin Origin, CSRF, closed route action, and query-
effect authorization; Redeven adds no alternate endpoint or relaxed guard.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic roles.
Activity, Workbench, window, widget, inventory, navigation, settings, and layout
are Redeven placement concepts and never manifest fields.

Browser state is a projection, not registry authority. It does not verify
packages or releases, mint tokens, serve assets, grant permissions implicitly,
or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Owns inventory, client lifetime, lifecycle commands, and cross-placement serialization.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx:1` - Carries exact inventory keys from tiles into management navigation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Selects exact inventory items and hosts external installation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Implements source, review, explicit confirmation, commit, and terminal result UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Isolates official and external identity, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, mobile modality, focus, and close.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Opens and retires only released SDK slots.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Owns persisted plugin widget open, replacement, removal, and cleanup.
- `redeven:internal/workbenchlayout/service_test.go:1080` - Covers persisted `redeven.plugin` widget state.

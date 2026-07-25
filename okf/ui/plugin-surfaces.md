---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through exact inventory identities, explicit review, SDK-owned surfaces, Activity windows, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Plugin UI is a released ReDevPlugin sandbox surface inside Redeven chrome.
Activity opens stable Shell-root windows; Workbench opens standard
`redeven.plugin` widgets. A vertical Activity Bar switcher launches ready
plugins or routes attention states to Plugin Center. Plugin Center combines
trust, policy, lifecycle, authorization, required access, and launch-target
state into one primary action per item. External installation is an explicit
source, security review, install, and completion flow; installed packages remain
disabled with zero grants. Redeven owns product navigation, review, geometry,
stacking, and placement. ReDevPlugin owns admission, iframe bootstrap, bridge,
lifecycle, confirmation, streams, and revocation. Failed exact-surface close is
retryable without widening authority to sibling surfaces or the session.

# Contract

## Discovery and exact inventory

The Activity Bar `Plugins` entry opens an opaque vertical switcher without
changing the current normal surface. Ready rows open their default Activity
surface; every row states its next action. Disabled, unavailable, not-installed,
permission-required, and policy-restricted rows open exact management details.
The desktop switcher is anchored and non-modal, while the mobile sheet is modal.
Plugin Center remains a dedicated Activity surface with a separate footer entry.

The Shell owns inventory loading, one platform client, shared scope, placement
controllers, and the selected product inventory key. Every catalog or installed
item has a stable `inventoryKey`; Panel tiles, Center rows, detail selection, and
commands carry that exact key. Plugin id is not unique, and instance id alone is
not used to select catalog presentation. This keeps an official catalog entry
and multiple external instances with identical manifest ids independent.

Official Containers catalog presentation requires exact publisher, plugin,
version, package, manifest, and entries identity. Current unsigned content keeps
its unsigned/manual-update state. Historical content additionally requires the
fixed catalog instance and Host-verified official signature. Official-looking
ids never inherit catalog trust or update controls.

Lifecycle commands carry the current management revision. Permission mutations
also carry policy revision and revoke epoch. Unknown mutation outcomes invalidate
affected surfaces and refresh inventory without blind retry. Plugin Center admits
one mutation at a time. Its presentation model evaluates trust and execution
approval first, then policy, updates, required access, runtime readiness, and
lifecycle. Open is available only for a ready launch target. Update and disable
are secondary actions; uninstall opens a dedicated keep-or-delete-data dialog.
Every dialog open resets to keep data, while delete data requires a separate
destructive confirmation before mutation submission. On narrow screens, list
selection enters a detail view, focuses its explicit back action, and restores
focus to the originating inventory row on return. Tablet and desktop layouts
keep the inventory master and selected detail side by side.

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

Update source entry preserves only reusable public identity. GitHub may prefill
its public repository, while package URLs and uploads require fresh input. Every
update remains bound to the exact instance and management revision.

The opaque review dialog exposes four visible stages: source, security review,
install, and done. Review starts with immutable identity, Host provenance,
signature, execution approval, update eligibility, and the disabled/zero-grant
result. The complete Host security summary remains available by category and
item, changed update access expands automatically, and hashes and confirmation
digest remain progressively disclosed. Policy-blocked results retain reason
codes instead of collapsing into an unsigned-package warning.

Invalid, revoked, or policy-blocked assessment disables commit. Absent,
unknown-signer, and temporarily unavailable signatures show a prominent risk
state but may be explicitly confirmed. Commit is unavailable until confirmation,
and the dialog cannot close while commit is in flight. Response-loss query uses
the exact inspection and commit identity. After an unknown or in-progress result,
the dialog cannot close or return to source; retry remains query-only across
bounded reconciliation timeouts until terminal.
An in-progress update retires its visible slots while reconciliation is pending.
A failed terminal result keeps the installed revision eligible to reopen; a
timeout, abort, or otherwise unresolved in-progress outcome fences that revision
until inventory proves a newer runnable target.
After commit, the plugin is visibly disabled with zero grants and manual updates
unless verified evidence allows automatic updates. The completion action enters
the exact installed detail for permission review and manual enablement. A refresh
failure after a terminal commit exposes only an inventory refresh recovery and
never a second commit action. Unknown outcomes offer only same-inspection
reconciliation and explicitly prohibit starting another installation.

## Permissions and policy

Plugin Center joins installed records, active grants, Host permission
requirements, and security policy. Official Containers explains its four
permission groups; missing required read access blocks open with a permission
explanation rather than a Docker error.

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

The Shell owns the only Activity registry, exact-target deduplication, activation
stack, bounded z-order, and geometry persistence. Reopening activates the stable
window. Capacity eviction awaits the least-recently-active exact close; failure
preserves its recovery shell and rejects the new open. On mobile the same stable
DOM becomes full-screen; only the active window receives input and accessibility
exposure, while hidden windows retain DOM and released `hidden` lifecycle.

Closing during surface opening queues visibly until the exact close handler is
ready. Close first attempts the `hidden` lifecycle hint, awaits released
idempotent single-surface reconciliation, and disposes only after exact close
success. A `hidden` delivery failure does not override successful close and
local disposal. A close failure keeps the slot and window recovery shell so
retry repeats only the same exact close. If exact close succeeded but local
disposal failed, retry skips close and repeats only local disposal. Ending
the whole session is a separately confirmed destructive fallback. Local iframe
disposal is not revocation evidence, and uncertain close never affects siblings.

## Workbench widgets and placement

Workbench uses the normal projected widget type `redeven.plugin`. Its persisted
state contains the exact plugin instance, plugin id, surface id, display name,
and management revision. Restore resolves it against current inventory before a
fresh slot mounts. Disabled, removed, permission-blocked, or unresolved records
never open stale authority; their placeholder opens the matching Plugin Center
detail. Duplicate open, replacement, removal, and `closeAll` share the controller
and retain targets whose cleanup must be retried.

The SDK's source/port-bound interaction observations drive Redeven's existing
local wheel, selection, action, activation, focus, and floating-layer policy.
They are presentation input only, not permission or identity evidence. Redeven
does not add an overlay, toggle iframe pointer events, guess focus, synthesize DOM
events, or establish a second MessageChannel.

Placement operations are globally serialized. Move, revision replacement, and
removal await old-slot close before state or a fresh slot commits. Every new
placement receives a fresh lease, iframe, and surface instance; no iframe moves.

## Confirmation and teardown

Surface capability confirmations use one abort-aware FIFO product dialog. The
trusted plan summary, plugin display name, action, target, and impact lead the
decision; method, hashes, tokens, and technical identities are folded into
details. Redeven does not infer risk from manifests or method names. Cancel owns
initial focus, each request is decided independently, and hidden, retired, or
revoked surfaces cannot approve queued work.

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
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPresentation.ts:1` - Combines trust, policy, authorization, lifecycle, and launch readiness into one primary action.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Implements source, review, explicit confirmation, commit, and terminal result UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Isolates official and external identity, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, mobile modality, focus, and close.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Opens and retires only released SDK slots.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Owns persisted plugin widget open, replacement, removal, and cleanup.
- `redeven:internal/workbenchlayout/service_test.go:1080` - Covers persisted `redeven.plugin` widget state.

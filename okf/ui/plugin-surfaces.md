---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through an accessible Launcher, searchable category discovery, exact inventory identities, explicit review, SDK-owned surfaces, Activity windows and pinned pages, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-29T00:00:00Z
quality_exception: Cross-surface plugin UX contract spanning exact inventory, discovery, package review, lifecycle governance, and Activity and Workbench placement.
---
# Summary

Plugin UI uses released ReDevPlugin sandbox surfaces inside Redeven-owned
navigation and placement. The Launcher and Plugin Center route exact inventory
identities through discovery, lifecycle review, permissions, installation,
updates, and recovery. Activity opens a Shell-root window, an Activity Bar pin
opens a full main-area page, and Workbench opens a `redeven.plugin` widget, with
fresh SDK slots for every placement change. ReDevPlugin remains the
authority for package admission, lifecycle `action_state`, confirmations,
Events, bridge sessions, exact-surface close, and revocation; Redeven owns the
accessible product presentation, filters, and serialized placement. Unknown
mutation or close outcomes require platform reconciliation, never wider teardown
or blind retry.

# Contract

## Discovery and exact inventory

The Activity Bar `Plugins` entry opens a Shell-root Launcher without changing
the current normal surface. Desktop uses a centered modal with a search field,
responsive icon grid, stable scrolling body, and fixed footer; mobile uses a
bottom sheet with the same controls and at least 44px touch targets. Search normalizes Unicode with
NFKC and locale-aware case folding, matches display name, canonical keywords,
and the locale's explicit alias key, and intersects with the selected category.
The category set is stable (`development`, `infrastructure`, `data`,
`collaboration`, `productivity`, `other`) and never inferred from localized
labels. Category controls stay hidden below six installed plugins and appear at
six without changing category identity. Empty results provide a single
clear-filters action. A launchable plugin tile's primary action opens its
declared default surface directly; plugins that cannot launch fall back to
their exact management detail by `inventoryKey`.
Escape clears search before closing, focus is trapped and restored, background
content is inert, and arrow/Home/End navigation remains within the visible grid.
Each plugin is a semantic list item containing a native primary button. The
compact launcher header exposes one market icon action for Plugin Center;
plugin tiles do not render a visible overflow button. Right-click, Context Menu,
and Shift+F10 expose exactly one mode-specific pin or unpin action, with arrow,
Home/End, Enter, Escape, outside dismissal, and focus restoration. The menu uses
the released `SurfaceFloatingLayer`; Workbench requests project into the owning
surface rather than viewport-fixed coordinates. In Workbench placement, installed
tiles and pinned Dock items use the released Floe Webapp drag transaction. Over
the canvas it projects the standard `redeven.plugin` frame from its 1120 by 760
world-unit definition; pointer release commits the same resolved world center,
so zoom, pan, and edge auto-pan cannot move the created widget away from its
preview. A canvas drop creates a fresh widget without recentering the viewport,
while a Dock drop only pins the inventory item. Cancellation or release outside
both targets performs no action. Pin persistence is one renderer- and
environment-scoped v2 record with independent ordered `activityInventoryKeys`
and `workbenchInventoryKeys` lists. v1 Dock order migrates only into the
Workbench list. Duplicate operations are idempotent, malformed or future state
fails closed, and an unavailable plugin leaves a dormant record that reappears
when its current inventory target becomes launchable. Absent product mutation
APIs are not simulated. Click suppression after a drag belongs only to Floe's
shared drag transaction; the Launcher keeps no second suppression flag.

The Workbench Launcher is a Dock companion, not a page-level modal. It mounts
through `WorkbenchDockPopoverSurface` in the owning Workbench surface, delegates
projection and clamping to the shared floating layer, and inherits the Dock
background, border, shadow, blur, and theme material. Its own size, radius,
content layout, search, focus loop, and close behavior remain product-owned.
Activity placement keeps the existing Shell-root modal behavior.
Plugin Center remains a dedicated Activity surface with a separate Launcher
entry and uses the same category/search projection. Its local filters combine
source (official catalog or external), trust, and lifecycle without rebuilding
identity. Every filter trigger permanently names its dimension and current
value, exposes a dropdown affordance, and keeps one clear-all action visible
whenever search, category, source, trust, or lifecycle filtering is active.
The title, search, refresh, and administrative menu form a compact primary
toolbar; tabs, categories, and filters form a second scroll-contained band
without page-level horizontal overflow. Discover, Installed, and Updates use
one responsive compact card directory with 48px identity icons and independent
primary, surface, overflow, and detail commands. Updates carry an explicit
information treatment and update command. Refresh status remains outside the
card grid, so a pending refresh cannot appear as a duplicate card. The inspector
orders identity and summary, primary actions, manifest-owned author description
and highlights, required and optional permissions, issue evidence, and collapsed
technical information. Its identity and primary-action region remains stable
while the author, permission, issue, and technical body scrolls independently;
long localized copy cannot push the current action out of view. Policy caps,
effective grants, revocation, and required-to-open semantics remain distinct.
Startup recovery is per installed plugin rather than a Plugin Center-wide
loading boundary. The shell, catalog, filters, and ready plugin actions remain
interactive while another plugin recovers. Each recovering card names its own
state; each failed card shows the safe reason and one explicit Retry action, and
only that failed plugin's Open controls are disabled. Repeated Retry input shares
the in-flight recovery operation and cannot create duplicate submissions.
The directory opens with no inspector selected. Only an explicit item selection
or Shell exact-key request opens detail; closing detail preserves the directory
tab, query, and filters, then restores the originating exact item when it is
visible or the search field when retained filters hide it. A committed external
install or update protects its exact instance selection from retained filters
until the user changes directory context or closes detail. A Shell request remains
bound to its requested item even when retained filters exclude it. External
installation is visible only to administrators as a lower-weight overflow action
and does not compete with primary discovery.

Plugin motion is progressive feedback rather than an interaction gate. New
Launcher, directory, detail, review, confirmation, loading, error, and recovery
states enter over 150–200ms; repeated directory items use a bounded stagger, and
interactive controls transition only explicit color, border, shadow, opacity,
and transform properties. Press feedback begins immediately and never delays the
underlying command. `prefers-reduced-motion: reduce` removes entry animations,
transform feedback, disclosure motion, and nonessential transitions while
preserving the same focus, selection, loading, and recovery behavior.

The Shell owns inventory loading, one platform client, shared scope, placement
controllers, and the selected product inventory key. Every catalog or installed
item has a stable `inventoryKey`; Panel tiles, Center rows, detail selection, and
commands carry that exact key. Plugin id is not unique, and instance id alone is
not used to select catalog presentation. This keeps an official catalog entry
and multiple external instances with identical manifest ids independent.

Inventory lifetime follows the authenticated Host session, not the visibility
of the Launcher or Plugin Center. Once the protocol and local plugin session are
ready, the Shell prefetches one projection in the background. Closing or
reopening either surface neither cancels nor reloads it. A lifecycle mutation,
explicit retry, or session change refreshes through that same owner. During a
same-session refresh the last successful projection remains interactive, so the
Launcher never replaces existing tiles with a visible loading banner or an
empty-state flash. A refresh failure keeps that projection; only a first load
with no successful snapshot exposes an actionable error. Disconnect or session
replacement aborts the old request and clears its projection boundary before a
new owner can publish results. This process-local projection is not durable
plugin state; Host catalog and `action_state` remain authoritative.

Official catalog presentation comes from the current latest-only market snapshot,
which the Host refreshes and atomically swaps without restarting the Desktop
and ultimately from the signed manifest. It requires exact publisher, plugin,
version, package, manifest, and entries identity. Historical content additionally
requires the fixed catalog instance and Host-verified official signature.
Official-looking ids never inherit catalog trust or update controls, and Redeven
does not carry plugin-specific author presentation.

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

## Session recovery

After a direct-session handshake, the Shell requests the idempotent Host
`recoverEnabled` snapshot on the explicit authenticated plugin-session-ready
transition; it does not insert a stability timer. Plugin Center remains
interactive while enabled plugins recover and may present each Host-projected
result with an explicit Retry action. The Host owns recovery identity,
single-flight, timeout, package binding, and retry semantics. Env App stores no
failed-instance or catch-up owner and never turns recovery presentation into a
second open gate. Cards, details, launchers, and placement commands consume the
Host `action_state`; they do not derive `can_open` from trust, policy, grants, or
recovery flags.

## Official installation progress

The pre-install interaction has one target-owned flow: `idle`, `review_ready`,
`installing`, then `installed`; task failure is owned only by the shared install
projection. A card or detail click opens the dialog in the same UI turn and
reads the market-cached `install_preview`; no package request or Host inspection
is started. The concise review shows only icon, name, publisher, version, source,
and grouped declared permissions, followed by `The publisher declares these
permissions; they will be verified during installation.`

The preview identity includes the plugin instance, market generation, complete
release reference, release-identity digest, manifest digest, contract-set digest,
and summary digest. A changed target is stale and requires market refresh; stale
completion cannot open another plugin's dialog. Confirmation submits exactly that
identity and keeps the existing default-enable Host path.

Uninstall retires the prior local management revision before the Host mutation.
When a later official reinstall reaches terminal success, inventory refresh,
required permission setup, and activation must all complete before the Shell
clears the exact retirement fence captured by that install attempt. A newer
disable, permission decision, uninstall, or unknown mutation outcome supersedes
the install and keeps its newer fence authoritative. Each completed Execution's
post-install setup commits at most once in the current Shell; recovery may
finish only required permissions that have no durable prior decision and never
re-enables a user-disabled plugin or restores a denied, revoked, or expired
grant. Inventory retains every current durable Host permission decision,
including denied, revoked, and expired records, while deriving current grant
state from effect, revocation, and expiry. The current authoritative launch
target is openable immediately only after that bounded setup succeeds; failed,
superseded, or incomplete reinstalls cannot revive a stale surface.

Official installation uses the released durable Execution instead of a
page-bound pending flag. The dialog shows four fixed steps: `download`, `verify`,
`install`, and `enable`, with completed, running, pending, or failed state. A
total progress bar advances by stage; download may show byte progress, while
verification, install, and enable remain indeterminate. Search, filters, scrolling,
detail reading, panel close, and unrelated surface launch stay available while
installation continues. Closing the dialog only hides it; the card or task area
retains the current stage and one recovery action.

The Shell has one observer per plugin attempt and retains the original request
identity. It reattaches to the same Host Execution after Plugin Center reopens or
transport reconnects. A lost start response replays the exact reviewed command
with the same request id; it does not start a competing poller. Closing the panel
never cancels installation. Terminal failures use the released error code, stage,
and `retryable` fact to produce one message and one action; raw backend messages
are not primary UI and cards, details, dialogs, and notifications do not repeat
the same error. A retry creates a new request only when the Host has confirmed a
retryable terminal failure. If the exact reviewed command is unavailable after a
restart, the only action is a fresh review. After success, inventory is
refreshed before the temporary status is removed. Refresh failure remains a
separate inline recovery state and must not be reported as installation failure.
The startup observer waits for that inventory before resolving durable plugin
identities. A confirmed historical-data erase keeps the exact binding revision;
absence on retry means the prior delete committed, while a changed revision
requires a new confirmation. Opening the erase dialog transfers the sole error
presentation into that dialog.
Cards and inspector share the same accessible `aria-busy`, live-status, alert,
and progress projection.

## Update review and confirmation

Plugin Center's Updates card and inspector expose one primary `Review update`
action. Opening it creates an exact update intent and never submits a mutation,
refreshes inventory, changes tabs, or replaces the current selection. Activity
and Workbench remain overflow actions while an update is available. The dedicated
update dialog owns source-required, loading-review, review, installing,
reconciling, and complete states. Its fixed footer always exposes an explicit,
single-line target action such as `Update to vX`, `Install new build`, or
`Replace current build`; low-height and narrow layouts scroll only the body.

The immutable update candidate binds the exact plugin instance, management
revision, current and target versions, package, manifest, entries, contract-set,
and summary hashes. Before install, Redeven rechecks the current inventory
revision and market generation. A changed target is stale and requires a fresh
review; it is never silently substituted. Version upgrades, same-version external replacements,
exact-package no-ops, and downgrades are projected centrally rather than inferred
separately by cards and dialogs.

Official security declarations come only from the market preview generated from
the final package and exact capability contracts; installation is the final
verification authority. Redeven does not maintain
official-plugin release notes or synthesize publisher notes from manifests,
source history, plugin identity, or host locale catalogs. Missing publisher notes
remain visibly absent.

Install starts only from the review footer. Development builds and external
replacements require a concise adjacent risk acknowledgement; ordinary verified
version upgrades need no redundant checkbox. Install prevents close and duplicate
submission. The Host rebinds the exact owner/session and revalidates the exact
bytes and expected hash before its atomic control-database transaction. An unknown
transport outcome retires stale UI authority and requires inventory refresh; it
does not create receipt/query state or resubmit the mutation. Successful install
remains in a complete dialog until the user chooses Activity, permissions,
or Done. Inventory refresh failure is reported separately from mutation failure.
Closing completion preserves the Updates tab, clears obsolete exact selection,
and shows an `All plugins are up to date` success state when no updates remain.

## External package review

Administrators may start installation or update from a compatible public HTTPS
package URL, public GitHub repository Release with optional tag, or local
`.redevplugin` file. The product submits the source and intent to the released
inspection API; it never downloads remote bytes in the browser, parses the
package, chooses trust state, or invents provenance.

An official Discover action uses the exact signed release reference from the
validated market snapshot. Redeven passes the matching immutable GitHub Release
transport to ReDevPlugin and never downloads package bytes in the browser. If
the market is unavailable, installed plugins remain visible and usable while
discovery and release installation show one retryable unavailable state. An
invalid or expired official release never falls back to external-package review.

Update source entry preserves only reusable public identity. GitHub may prefill
its public repository, while package URLs and uploads require fresh input. Every
update remains bound to the exact instance and management revision.

The opaque review dialog exposes four compact visible stages: source, security
review, install, and done. Review starts with immutable plugin identity, a
concise source identity, and one plain-language trust decision. The primary UI
does not expose execution-approval field names or reason codes. It explains why
the exact package requires confirmation; full approval state and reason evidence
remain in the initially collapsed report. Invalid, revoked, and policy-blocked
results remain top-level blocked decisions. Absent, unknown-signer, and
temporarily unavailable signatures remain top-level caution decisions that
require exact-package confirmation. Verified, user-approved, and policy-approved
assessments still require product confirmation and never imply a permission grant.

The review presents one outcome-led access and operation-impact summary instead
of separate permission and method inventories. Host permission declarations are
shown only as a protected-access count in that summary. Methods are grouped by
the released `read|write|execute|delete|admin` effect set, never as granted
permissions or completed actions. Dangerous methods remain prominent regardless
of effect, and an unrecognized runtime value fails visible as an additional
high-attention group. Raw permission identifiers, method names, effects, routes,
preflight, confirmation, and contract facts remain in the complete report.
Network destinations, worker artifacts, secret references, and contract-proven
storage writes use observable capability language without inferred business
purpose.

The next review level shows declared worker code, external destinations, secret
references, operation-impact groups, core actions, and every sensitive added or
changed update declaration. An update also shows the total added, changed, and
removed count before confirmation and explicitly says when declared access is
unchanged. If no permission or operation is declared, each empty state remains
separate and makes no claim that the plugin is safe, trusted, or authorized. The
complete Host inspection report is always initially closed;
its entry carries the update-change count, and an explicit open expands the
categories containing added or changed declarations while removed-only and
unchanged categories remain closed. The report retains the complete Host source
provenance, inspection id, expiry, intent, signature, execution approval, update
eligibility, reason codes, security summary by category and item, package,
manifest, entries, and security-summary hashes, and confirmation digest.
Progressive disclosure changes prominence only and never removes authoritative
inspection facts. Policy-blocked results retain their exact reason codes instead
of collapsing into an unsigned-package warning.

The exact-package confirmation control stays in the fixed action footer and
remains visible while the review body scrolls. Its concise decision copy does
not repeat the confirmation digest; the complete report retains that exact
evidence. First install confirmation states that the Host will persist the
plugin as enabled without silently granting permissions. Update or reinstall
confirmation states that the Host retains enabled state and existing grants and
adds no grants automatically.

Invalid, revoked, or policy-blocked assessment disables install. Absent,
unknown-signer, and temporarily unavailable signatures show a prominent risk
state but may be explicitly confirmed. Install is unavailable until confirmation,
and the dialog cannot close while the Host mutation is in flight. An update closes
its visible slots before install; failure to close blocks the mutation. Unknown
outcome retires the stale management revision until authoritative inventory is
reloaded, so queued stale opens cannot pass.
After a fresh install, the plugin is visibly enabled; missing required grants
are shown as permission attention and block only the affected open or capability
call. After an update or reinstall, completion reads the authoritative inventory
record, retains existing grants, and claims only that no new grants were added.
Manual updates remain the default unless verified evidence allows automatic
updates. Equal SemVer never proves latest: equal package hashes offer exact-package
reinstall, different hashes warn that content differs, and missing prior hash
states that equality cannot be determined. Every case remains bound to the
exact update intent and inspection digest. The completion action enters
the exact installed detail for permission review. A refresh
failure after a terminal install exposes only an inventory refresh recovery and
never a second install action.

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

## Activity windows and pinned pages

Each Activity window owns one fresh `PluginSurfaceSlot` and opens it only through
`openSurfaceInSlot`. The SDK Promise is the sandbox load, bridge handshake,
worker readiness, and first-commit boundary. Redeven creates no iframe,
bootstrap, asset session, or bridge.

Opening and closing show quiet placement-owned status layers. An opening or
bridge failure replaces the iframe area with a recovery panel. Retry first
retires the failed slot, then creates and opens a fresh slot; it never reuses the
failed iframe, host, bridge, or surface instance.

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

Desktop Activity pins use the manifest-verified current name and icon and a
stable component id derived from `inventoryKey`. Released
`FloeRegistryContributions` serializes dynamic registration and unregistration;
`ActivityAppsMain` mounts the full-page contribution on first activation and
keeps its DOM while other Activity pages are selected. View activation drives
the released `visible` and `hidden` lifecycle, and returning to the page does not
create another slot. The Activity Bar, top bar, and bottom bar remain visible.
Mobile never receives dynamic plugin tab entries and continues to use the
Launcher and Activity window presentation.

Moving the same target from a pinned page to an Activity window or Workbench
first awaits the exact pinned-page close, removes its body from the retained
contribution, then opens a fresh slot. Returning to the pin likewise creates a
fresh slot rather than reviving or moving the old iframe. Unpin first closes the
mounted page; close failure retains both the shortcut and recovery presentation.
Successful unpin of the active page selects the latest built-in Activity page.
Restart restores shortcuts but always begins on a built-in page, so startup does
not automatically open third-party content.

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
Clicking a pinned Dock item creates or focuses the same standard widget, and its
drag placement uses the released world-coordinate drop result. Unpinning the
Dock removes only the shortcut and never removes an existing canvas widget.

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
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx:1` - Carries exact inventory keys into launch, drag, and mode-specific pin menus.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPinContextMenu.tsx:1` - Owns accessible pin-menu keyboard, outside-dismissal, focus restoration, and surface-aware projection.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginDockPins.ts:1` - Owns v1-to-v2 migration and independent ordered Activity and Workbench pin lists.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Selects exact inventory items and owns install and update-review entry state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Presents the target-bound review, fixed confirmation footer, reconciliation, and retained completion state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Classifies update targets and fences revision, inspection expiry, and package identity.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts:1` - Projects verified market releases and manifest-owned presentation without plugin-specific author copy.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterItems.tsx:1` - Presents the compact Discover, Installed, and Updates card directory without owning selection or mutations.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Consumes Host `action_state`, RecoverySnapshot, Execution, and Event DTOs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/plugin-motion.css:1` - Defines the scoped subtle entrance and disclosure motion with a reduced-motion override.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Verifies responsive plugin geometry, real motion timing, and reduced-motion operability.
- `redeven:internal/envapp/ui_src/src/ui/plugins/externalPluginSecurityProjection.ts:1` - Projects security declarations, update deltas, and operation impact without UI state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Implements source, review, explicit confirmation, Host install, and terminal result UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Isolates official and external identity, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, mobile modality, focus, and close.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx:1` - Projects a pinned surface into Activity KeepAlive activation and visibility lifecycle.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Opens and retires only released SDK slots.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Owns persisted plugin widget open, replacement, removal, and cleanup.
- `redeven:internal/workbenchlayout/service_test.go:1080` - Covers persisted `redeven.plugin` widget state.

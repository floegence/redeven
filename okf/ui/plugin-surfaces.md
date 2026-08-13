---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through an accessible Launcher, searchable category discovery, exact inventory identities, explicit review, SDK-owned surfaces, Activity windows, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-29T00:00:00Z
quality_exception: Cross-surface UI contract spanning exact plugin identity, Launcher discovery, Center governance, Activity placement, and Workbench placement.
---
# Summary

Plugin UI embeds released ReDevPlugin sandbox surfaces in Redeven chrome.
Activity opens Shell-root windows; Workbench opens `redeven.plugin` widgets. The
Activity Bar Launcher provides stable categories, keyboard navigation, search,
and exact inventory routing, while Plugin Center presents trust, lifecycle,
access, and launch state. External installs require explicit source review and
commit; fresh installs start disabled with zero grants. Updates require a
side-effect-free, target-bound review and retain Host-managed state and grants
without adding any. Redeven owns navigation, review, placement, and filters;
ReDevPlugin owns admission, sandbox and bridge lifecycle, confirmations, streams,
and revocation. Failed exact-surface close remains retryable without wider
authority.

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
plugin tiles do not render an overflow menu. In Workbench placement, installed
tiles use the released Floe Webapp external Dock drag session and can be pinned
as an additional Dock projection without removing the inventory item. Pin
persistence is renderer- and environment-scoped, versioned, ordered,
idempotent, and malformed or future state fails closed. Absent product mutation
APIs are not simulated.
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

Official catalog presentation comes from the frozen latest-only market snapshot
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

After a direct-session handshake, the Shell starts recovery on the explicit
authenticated plugin-session-ready transition; it does not insert a fixed
stability timer. The handshake credential can precede the server-side scope
needed by that mutation. ReDevPlugin `v0.7.27` normally reconstructs activation after Host
restart or process-local lease expiry from sealed local registry and
release-trust evidence without remote artifact downloads; Redeven retains a
bounded 90-second outer timeout as a fail-closed guard rather than a normal
recovery budget.

Plugin Center remains interactive while enabled plugins recover. Recovery is
projected by exact `plugin_instance_id` plus installed package/manifest/entries
identity: a recovering plugin remains closed,
ready plugins remain openable, and a failed plugin alone shows its stable typed
reason with an explicit idempotent Retry action. Retry returns that plugin to
recovering and shares the Host single-flight operation; it never reloads the
page, opens a surface early, or grants fallback authorization. A disconnect,
replaced client, or Shell disposal aborts the pending wait and refresh. Results
from that superseded client generation are discarded instead of being projected
as a user-visible plugin failure. The released Host gives each plugin a
15-second recovery deadline, reports deadline exhaustion as `recovery_timeout`,
and lets a healthy new-session follower take over after an old canceled leader
without inheriting the ended context. Only
one recovery may be active for a connected client. An instance installed or
enabled after the connected client's initial recovery remains closed until a
subsequent Host refresh covers its exact id. If it appeared while the initial
refresh was in flight, the Shell schedules at most one catch-up for that exact
uncovered-instance set; an empty result cannot create an implicit retry loop.
A typed failure remains sticky for the connected client, including while the
inventory projection catches up; only the explicit Retry action clears that
instance's failure marker.

## Official installation progress

Official installation uses the released durable install operation instead of a
page-bound pending flag. Only the target plugin card and inspector show its
queued, trust verification, release inspection, download, package verification,
commit, reconciliation, success, or failure state. A byte progress bar is shown
only for Host-reported byte progress; all other active phases remain visibly
indeterminate. Search, filters, scrolling, detail reading, panel close, and
unrelated surface launch stay available while installation continues.

The Shell retains the original request identity and reattaches to the same Host
operation after Plugin Center reopens, transport reconnects, or a start response
is lost. Closing the panel never cancels installation. Terminal failures use
stable error code, phase, and retryability to select complete locale-owned copy;
raw backend messages are not primary UI. A retry creates a new request only when
the Host has confirmed a retryable terminal failure. After success, inventory is
refreshed before the temporary status is removed. Refresh failure remains a
separate inline recovery state and must not be reported as installation failure.
Cards and inspector share the same accessible `aria-busy`, live-status, alert,
and progress projection.

## Update review and confirmation

Plugin Center's Updates card and inspector expose one primary `Review update`
action. Opening it creates an exact update intent and never submits a mutation,
refreshes inventory, changes tabs, or replaces the current selection. Activity
and Workbench remain overflow actions while an update is available. The dedicated
update dialog owns source-required, loading-review, review, committing,
reconciling, and complete states. Its fixed footer always exposes an explicit,
single-line target action such as `Update to vX`, `Install new build`, or
`Replace current build`; low-height and narrow layouts scroll only the body.

The immutable update candidate binds the exact plugin instance, management
revision, current and target versions, package, manifest, and entries hashes.
Before commit, Redeven rechecks the current inventory revision and inspection
expiry. A changed target is stale and requires a fresh review; it is never
silently substituted. Version upgrades, same-version external replacements,
exact-package no-ops, and downgrades are projected centrally rather than inferred
separately by cards and dialogs.

Host security evidence comes only from the released inspection result; only that
evidence may claim no security-declaration changes. Redeven does not maintain
official-plugin release notes or synthesize publisher notes from manifests,
source history, plugin identity, or host locale catalogs. Missing publisher notes
remain visibly absent.

Commit starts only from the review footer. Development builds and external
replacements require a concise adjacent risk acknowledgement; ordinary verified
version upgrades need no redundant checkbox. Commit prevents close and duplicate
submission. A typed not-committed result returns to the same review, while an
unknown result enters query-only reconciliation and never resubmits. Successful
commit remains in a complete dialog until the user chooses Activity, permissions,
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
frozen market snapshot. Redeven passes the matching immutable GitHub Release
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
evidence. First install confirmation states the disabled, zero-grant result.
Update or reinstall confirmation states that the Host retains enabled state and
existing grants and adds no grants automatically.

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
After an install commit, the plugin is visibly disabled with zero grants. After
an update or reinstall, completion reads `plugin.enable_state` from the Host
receipt, retains existing grants, and claims only that no new grants were added.
Manual updates remain the default unless verified evidence allows automatic
updates. Equal SemVer never proves latest: equal package hashes offer exact-package
reinstall, different hashes warn that content differs, and missing prior hash
states that equality cannot be determined. Every case remains bound to the
exact update intent and inspection digest. The completion action enters
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
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Selects exact inventory items and owns install and update-review entry state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Presents the target-bound review, fixed confirmation footer, reconciliation, and retained completion state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Classifies update targets and fences revision, inspection expiry, and package identity.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts:1` - Projects verified market releases and manifest-owned presentation without plugin-specific author copy.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterItems.tsx:1` - Presents the compact Discover, Installed, and Updates card directory without owning selection or mutations.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPresentation.ts:1` - Combines trust, policy, authorization, lifecycle, and launch readiness into one primary action.
- `redeven:internal/envapp/ui_src/src/ui/plugins/plugin-motion.css:1` - Defines the scoped subtle entrance and disclosure motion with a reduced-motion override.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Verifies responsive plugin geometry, real motion timing, and reduced-motion operability.
- `redeven:internal/envapp/ui_src/src/ui/plugins/externalPluginSecurityProjection.ts:1` - Projects security declarations, update deltas, and operation impact without UI state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Implements source, review, explicit confirmation, commit, and terminal result UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Isolates official and external identity, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, mobile modality, focus, and close.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Opens and retires only released SDK slots.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Owns persisted plugin widget open, replacement, removal, and cleanup.
- `redeven:internal/workbenchlayout/service_test.go:1080` - Covers persisted `redeven.plugin` widget state.

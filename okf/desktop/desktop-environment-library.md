---
type: Desktop Contract
title: Desktop Environment library
description: Browse one relationship card through independent Runtime and Cloud access perspectives, including Cloud source grids.
tags: [desktop, environment, cloud, welcome]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Welcome derives one Environment library from original snapshot owners. An exactly linked Runtime and Cloud Environment share one card with switchable access perspectives; an independent Runtime, URL, or Cloud Environment has one perspective. The Environment overview and Redeven Cloud source sections consume the same groups. Display grouping never merges registrations, grants permissions, selects another transport after failure, or changes an operation's owner. Unlinking restores independent cards; synchronization failures retain known Cloud environments with explicit stale-result context.

# Contract

## Relationship identity and projection

Pair Local, SSH, or WSL Runtime entries only when the Runtime link target ID equals the Cloud linked-runtime summary ID and Provider origin, Provider ID, and ENV ID all agree. Names, addresses, and online status do not establish identity. The snapshot builder emits display summaries while a complete exact binding is linking, linked, or disconnecting. Candidate occupancy and operation authorization retain their own strict binding rules; a display summary grants no authority. Unbound, unrelated, or missing counterparts remain independent.

Each group retains a stable primary Runtime ID, original owner references, member IDs, Cloud source identity, combined search content, and an any-owner pin result. A standalone Cloud group uses its Cloud entry ID. Build this projection once per snapshot; overview, source grids, filtering, layout, and summary counts consume it. Verified Gateway access members may join an original Runtime card under the
[verified access routes contract](desktop-environment-access.md), without adding
owner tabs. Independently registered direct management owners retain their
original cards and settings. Gateway management retains its separate projection.

Runtime entries own the observed link targets used by Cloud summaries and candidate occupancy. During a health refresh, cached Runtime Service identity keeps both sides of an existing pair consistent while live presence is withdrawn; a pending check alone must not split a pair or add a standalone Cloud card. Fresh unbound or changed identity immediately updates grouping. Current observed health takes precedence over historical open-window startup reports, and display continuity never restores live control authority.

## Access perspectives and owner actions

Linked cards expose Runtime and Redeven Cloud as a compact segmented selector in the same header slot used by standalone type badges. Exactly one owner content area and action footer is visible. Overview defaults to Runtime; a Cloud source or Cloud filter defaults to Cloud. Pure Cloud cards use the same Cloud content with a type badge instead of a single tab. Runtime content retains host placement, version, startup age, and lifecycle actions. Cloud content presents source, ENV ID, public remote entry, and the existing remote action model; it has no speculative local version, startup age, or missing-Runtime placeholder.

Tab selection switches the name, status, facts, primary action, refresh, pin, settings, and Flower launch context. Tabs use distinct device, terminal, and cloud icons with a recessed track and a neutral filled selected segment. A trailing amber dot marks an owner needing attention; in-progress work uses a small spinner in the same slot. The Cloud marker includes observed Runtime connection recovery even when the cached Cloud catalog still looks ready. Markers never cover the access icon; localized status text remains available to assistive technology and on hover. Cloud authorization or synchronization failure never disables Runtime actions. An existing Cloud window remains focusable while its authorization or remote-health warning stays visible and contributes to attention counts. Runtime actions never grant Cloud owners lifecycle or binding authority. Open uses the active owner's existing action model and never falls back to another perspective after a failure.

Selection belongs to the page session. Search and equivalent snapshots preserve it, including search temporarily hiding a card. Changing source filters resets to that scope's default, after which users can select either perspective. Switching tabs closes old menus and endpoint popovers without cancelling work. Already-open settings and Flower contexts remain bound to their original owner. Popovers, QR, focus, and progress use real owner IDs; perspective selection uses group IDs. Removing an owner prunes its selection and interactive surfaces. Stable owner and tab nodes preserve focus and selection across snapshot replacement.

A paired card keeps one compact Cloud connection row below the existing facts in either perspective. Its status opens an anchored details popover; inline Restore or Sign in actions remain small. Healthy, recovering and terminal states preserve card height and aligned grid footers. The popover explains local availability and Cloud status without occupying card layout. A signed-in account does not imply an online Runtime. Connection warnings explain service waits, account authorization, permission loss, changed associations, or certificate trust failures. Available local work has an explicit Open locally action; it never replaces a failed Cloud Open silently. Restore connection selects the exact original Runtime owner and opens its existing connection review. Sign in again belongs to the corresponding saved account. Permission, association, and certificate failures require review instead of blind retry. The popover uses the existing anchored overlay contract for viewport bounds, outside dismissal and Escape focus restoration. Diagnostics expand inside it to expose typed error codes and localized last-attempt and next-check times, without credentials. Equivalent snapshots retain the popover, expanded diagnostics and focus. Switching perspectives or removing an owner closes it. Recovery mechanics belong to [RCPP saved connection recovery](../protocol/rcpp-v4-provider-api.md).

The page header keeps search and its action group on one aligned row. Only the search field grows or shrinks; tooltip anchors and action buttons retain their size. Below 640px, actions use clear icons in 44px minimum touch targets: a link for connecting Redeven Cloud, a plus for creating an Environment or adding a Gateway, and circular arrows for refreshing runtime status. Full localized action names remain available through accessible labels and focus/hover tooltips. Wider layouts use concise action text (New, Connect, Add); they do not repeat the Cloud product name inside the button. The search field uses the published Input icon slot and keeps the upstream focus treatment.

Cards use one compact responsive column model with a 16.25rem minimum column and a .75rem gap, within a 100rem page maximum. Increasing the inventory never widens individual cards or their gutters. Font scaling increases the minimum column width; source filtering preserves the unfiltered layout reference. Cards share a compact header, facts area, and footer. Compact spacing preserves every owner fact, the access selector, refresh and Flower controls, the split action menu, and the owner-scoped pin, settings, and removal controls. The quick-add card uses the same compact spacing so it cannot impose oversized empty rows on the library. Cards in each grid have equal heights and aligned action footers. Retained perspectives contribute to the same layout cell, so switching views does not change card height; the inactive perspective is invisible, inert, and hidden from assistive technology. Long identity and address values truncate with full details available. Card actions, access tabs, status rows, fact labels, and operation-menu items keep single-line text slots; longer translations use ellipsis without increasing control or card height. Full labels remain in accessible names and hover titles. Primary action height follows the font scale, not translation length; icons and menu toggles keep their space. The quick-add card uses a stable option grid and a two-line description slot so translated content cannot stretch neighboring cards. Enlarged text increases rem-based dimensions and reduces the column count without overflowing or hiding controls. Existing progress shimmer, operation state, and overlay behavior remain authoritative.

The retained Environment page keeps its last visible layout measurement while hidden behind Flower. A zero-width hidden element is not a one-column viewport. Returning to the page preserves card positions without replaying entrance motion. Open and equivalent health refreshes preserve card count, order, DOM identity and geometry. Deliberate Environment Center tab selection follows the separate [Welcome navigation presentation contract](desktop-welcome-navigation.md); its transient visual translation does not change card layout or restart on snapshots.

## Environment action menu

The Environment card's action menu keeps direct Runtime operations in their existing order. Gateway access and Cloud connection, recovery, and disconnection actions form one adjacent access group after those operations, separated from them by a single divider. No divider or lifecycle action appears between Gateway access and Cloud actions. Without Gateway access, the existing menu order remains unchanged; unavailable actions retain their original capability and disabled-state checks.

## Cloud sources and counts

Redeven Cloud presents one vertical section per signed-in account, followed by its shared Environment grid. The account overview separates Cloud-marked account identity and address, three numeric inventory metrics with icons, and a synchronization strip. Account identity and actions adapt to narrow layouts without hiding controls; long identity values retain their full text in titles. Each Cloud Environment appears once, including both linked Runtime pairs and pure remote environments. Source facts navigate directly to the corresponding Cloud section. Browsing either page creates no registration.

The overview offers Refresh during normal operation or synchronization failure, and Sign in again when authorization expires. A neutral Sign out action opens an account-specific confirmation; there is no control-plane deletion action. [RCPP authorization](../protocol/rcpp-v4-provider-api.md) owns the Desktop sign-out boundary. Status labels and recovery explanations use typed localization keys, never matching English transport text. Raw diagnostics are available only in the synchronization-details popover, which preserves focus across snapshots and returns focus on Escape. An account disappearing closes its confirmation and details surface.

Search matches source name, account and address, plus group names, ENV IDs and connection information. A source match includes all its environments; an Environment-only match includes only matching groups. No connected sources, a successfully synchronized empty source, an unavailable initial catalog, and no search matches have distinct messages. Failed synchronization retains known cards and labels counts as the last synchronization result. Account statistics count groups, observed online Cloud owners, and actual linked Runtime groups, independently of search results. Stale online counts do not use the fresh-online accent. An account with no synchronized catalog displays Not synced yet rather than Authorized, and never claims to show prior results before a successful sync.

Overview counts do not depend on the selected tab. Count each group once and sum windows by real member owner IDs. A group needs attention when any member needs attention. Running status uses Runtime health when a Runtime exists, otherwise the Cloud observation; readiness recognizes an available member. Either owner pin places the group in Pinned; pin controls affect only the active owner and explain when the other owner keeps the group pinned.

# Boundaries

[Environment registration ownership](desktop-environment-registrations.md) owns persisted records, serialized mutations and deletion. [Environment connections](desktop-environment-connections.md) owns address namespaces, popover and QR validity, and public versus private transport presentation. Connection recovery diagnostics are transient Desktop snapshot fields; they do not change persistence, Provider API, Runtime API, or management authority.

# Evidence

- `redeven:desktop/src/welcome/environmentLibraryProjection.ts` - Exact owner pairing and Cloud source membership.
- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Shared cards, stable perspectives, owner action and overlay control.
- `redeven:desktop/src/welcome/CloudConnectionStatus.tsx` - Independent local and Cloud state, actionable recovery and scoped diagnostics.
- `redeven:desktop/scripts/check-cloud-connection-ui.mjs` - Ten-locale recovery, exact owner actions, terminal failures and narrow-layout browser acceptance.
- `redeven:desktop/src/welcome/CloudAccountOverview.tsx` - Account identity, inventory metrics, localized sync details and sign-out action.
- `redeven:desktop/scripts/check-cloud-account-overview.mjs` - Ten-locale account layout, stale state, recovery, focus and sign-out acceptance.
- `redeven:desktop/src/welcome/App.tsx` - Source sections, source navigation, and shared grid composition.
- `redeven:desktop/src/welcome/viewModel.ts` - Owner facts, actions, filtering and group summaries.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Display summaries preserve in-flight binding identity without changing candidate rules.
- `redeven:desktop/src/main/desktopWelcomeRefresh.test.ts` - Deferred health probes preserve Local, SSH and WSL pairs while withdrawing presence and respecting completed unlinking.
- `redeven:desktop/src/welcome/environmentRelation.test.ts` - Real snapshot builder coverage for Local, SSH, WSL, transitions and failed Cloud synchronization.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` - Owner action isolation, source search, pin scope and refresh continuity.
- `redeven:desktop/scripts/check-environment-access-menu.mjs` - Adjacent Gateway and Cloud access actions, one group divider, unchanged card geometry, narrow layouts and keyboard traversal.
- `redeven:desktop/scripts/check-environment-relations.mjs` - Mixed grids, real browser actions, tab focus and ten-locale narrow/dark/enlarged-text acceptance.
- `redeven:desktop/scripts/check-welcome-card-stability.mjs` - Normal-motion per-frame Open, checking snapshots and retained-page return geometry in English and Simplified Chinese.
- `redeven:desktop/scripts/check-welcome-toolbar.mjs` - Single-row toolbar alignment, touch targets, concise labels, tooltips, and keyboard-activated creation workflows across every locale and narrow, wide, and enlarged-text layouts.

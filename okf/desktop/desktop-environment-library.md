---
type: Desktop Contract
title: Desktop Environment library
description: Browse one Runtime card through its original Runtime, Cloud and Gateway access tabs.
tags: [desktop, environment, cloud, welcome]
timestamp: 2026-10-10T00:00:00Z
---
# Summary

Welcome derives one Environment library from original snapshot owners. An exactly linked Runtime and Cloud Environment share one card with switchable access perspectives. Paired Gateways add one Gateway tab to this same Runtime card, with a member selector when needed; they do not add duplicate cards. Independent Runtime, URL and Cloud owners retain their cards. The Environment overview and Redeven Cloud source sections consume the same groups. Display grouping never merges registrations, grants permissions, selects another transport after failure, or changes an operation's owner. Unlinking restores independent cards; synchronization failures retain known Cloud environments with explicit stale-result context.

# Contract

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

## Relationship identity and projection

Pair Local, SSH, or WSL Runtime entries only when the Runtime link target ID equals the Cloud linked-runtime summary ID and Cloud origin, Cloud ID, and ENV ID all agree. Names, addresses, and online status do not establish identity. The access-point origin is a route coordinate: directory changes cannot split the same Cloud environment into another card. The snapshot builder establishes this identity once for display summaries and candidate occupancy; access ownership consumes that result without repeating the match. It emits display summaries while a complete exact binding is linking, linked, or disconnecting. Operation authorization retains its strict binding, generation and access-point checks; a display summary grants no authority. Binding facts, observed connection health and direct-management capability are independent. Gateway-managed Cloud publication, credential recovery, disabled remote access and an offline Cloud directory retain a valid saved association. Runtime validates saved binding shape without treating it as permission to connect; strict connection validation remains required. A fresh unbound or conflicting binding, unrelated identity, or missing counterpart remains independent. Runtime Service compatibility is defined by the current compatibility contract.

Each group retains a stable primary Runtime ID, original owner references, member IDs, Cloud source identity, combined search content, and an any-owner pin result. A standalone Cloud group uses its Cloud entry ID. The main process assigns one authoritative `access_group_id` for exact Cloud bindings and trusted Gateway membership. The renderer arranges these owners without repeating identity checks. Build this projection once per snapshot; overview, source grids, filtering, layout, and summary counts consume it. Verified Gateway access members may join an original Runtime card under the
[verified access routes contract](desktop-environment-access.md), with one shared
Gateway access tab and no duplicate card. Independently registered direct management owners retain their
original cards and settings. Gateway management retains its separate projection.

Runtime entries own the observed link targets used by Cloud summaries and candidate occupancy. During a health refresh, cached Runtime Service identity keeps both sides of an existing pair consistent while live presence is withdrawn; a pending check alone must not split a pair or add a standalone Cloud card. Fresh unbound or changed identity immediately updates grouping. Current observed health takes precedence over historical open-window startup reports, and display continuity never restores live control authority.

## Access perspectives and owner actions

[Environment card presentation](desktop-environment-card-presentation.md) owns the original compact tabs, facts, split footer, responsive layout and focus continuity. Each perspective keeps its real operation owner; Gateway pairing does not change Runtime lifecycle or Cloud authority. Search and equivalent snapshots preserve selection, while source filters apply their scope's default once.

## Gateway perspective

Trusted Runtime membership summaries expose Gateway name, public endpoints, member identity, phase and whether the member owns Cloud publication. The matching authorized Gateway catalog entry supplies its own Open route, settings and session context. Pairing alone grants no Desktop access: without that independent authorization the tab remains visible, while Open is disabled with an actionable explanation. The card keeps its Runtime name, original recessed tab styling, facts layout, equal-height owner stack and split footer. The Gateway selector survives equivalent snapshots and closes old route popovers when changed. Removing the selected pairing preserves selection while a session is open; after closure the selector may choose the first remaining member. A single remaining member needs no selector; a later membership refresh cannot restore the retired selection.

## Environment action menu

The Environment card's action menu keeps direct Runtime operations in their existing order. Gateway access and Cloud connection, recovery, and disconnection actions form one adjacent access group after those operations, separated from them by a single divider. No divider or lifecycle action appears between Gateway access and Cloud actions. Cancel Gateway pairing and Publish through Gateway use the same upward menu and existing icon/label layout. From the Gateway perspective, cancellation fixes the currently selected member and confirms only its actual Cloud impact, without another selector. If the fixed member has disappeared, confirmation cannot substitute another member. The closing confirmation retains its identity and operation copy through the published Dialog exit transition; another submission is disabled, and the next opening initializes a fresh session. From Runtime or Cloud, multiple members require an explicit choice; publication alone offers Cloud identity choices. Without Gateway access, the existing menu order remains unchanged; unavailable actions retain their original capability and disabled-state checks.

## Cloud sources and counts

Redeven Cloud presents one vertical section per signed-in account, followed by its shared Environment grid. The account overview separates Cloud-marked account identity and address, three numeric inventory metrics with icons, and a synchronization strip. Account identity and actions adapt to narrow layouts without hiding controls; long identity values retain their full text in titles. Each Cloud Environment appears once, including both linked Runtime pairs and pure remote environments. Source facts navigate directly to the corresponding Cloud section. Browsing either page creates no registration.

The overview offers Refresh during normal operation or synchronization failure, and Sign in again when authorization expires. A neutral Sign out action opens an account-specific confirmation; there is no control-plane deletion action. [RCPP authorization](../protocol/rcpp-v5-provider-api.md) owns the Desktop sign-out boundary. Status labels and recovery explanations use typed localization keys, never matching English transport text. Raw diagnostics are available only in the synchronization-details popover, which preserves focus across snapshots and returns focus on Escape. An account disappearing preserves confirmation and details, disables invalid submission and retains Close.

Search matches source name, account and address, plus group names, ENV IDs and connection information. A source match includes all its environments; an Environment-only match includes only matching groups. No connected sources, a successfully synchronized empty source, an unavailable initial catalog, and no search matches have distinct messages. Failed synchronization retains known cards and labels counts as the last synchronization result. Account statistics count groups, observed online Cloud owners, and actual linked Runtime groups, independently of search results. Stale online counts do not use the fresh-online accent. An account with no synchronized catalog displays Not synced yet rather than Authorized, and never claims to show prior results before a successful sync.

Overview counts do not depend on the selected tab. Count each group once and sum windows by real member owner IDs. A group needs attention when any member needs attention. Running status uses Runtime health when a Runtime exists, otherwise the Cloud observation; readiness recognizes an available member. Either owner pin places the group in Pinned; pin controls affect only the active owner and explain when the other owner keeps the group pinned.

# Boundaries

[Environment registration ownership](desktop-environment-registrations.md) owns persisted records, serialized mutations and deletion. [Environment connections](desktop-environment-connections.md) owns address namespaces, popover and QR validity, and public versus private transport presentation. Connection recovery diagnostics are transient Desktop snapshot fields; they do not change persistence, Provider API, Runtime API, or management authority.

# Evidence

- `redeven:desktop/src/main/environmentAccess.ts` - Authoritative connection ownership and preserved access defaults.
- `redeven:desktop/src/main/runtimeConnectionProjection.test.ts` - Raw Local/SSH/WSL observations, restricted Cloud management, offline catalogs, window deduplication and identity conflicts.
- `redeven:desktop/src/welcome/environmentLibraryProjection.ts` - One presentation of main-process ownership and Cloud source membership.
- `redeven:desktop/src/welcome/CloudAccountOverview.tsx` - Account identity, inventory metrics, localized sync details and sign-out action.
- `redeven:desktop/scripts/check-cloud-account-overview.mjs` - Ten-locale account layout, stale state, recovery, focus and sign-out acceptance.
- `redeven:desktop/src/welcome/App.tsx` - Source sections, source navigation, and shared grid composition.
- `redeven:desktop/src/welcome/viewModel.ts` - Owner facts, actions, filtering and group summaries.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Display summaries preserve in-flight binding identity without changing candidate rules.
- `redeven:desktop/src/main/runtimeConnectionProjection.test.ts` - Cloud identity survives directory access-point changes while other Cloud identities remain separate.
- `redeven:desktop/scripts/check-cloud-runtime-cards.mjs` - Production Electron and Runtime acceptance covers offline Cloud, live Gateway pairing, v2 state upgrade, restart and targeted removal in one card.
- `redeven:desktop/src/main/desktopWelcomeRefresh.test.ts` - Deferred health probes preserve Local, SSH and WSL pairs while withdrawing presence and respecting completed unlinking.
- `redeven:desktop/src/welcome/environmentRelation.test.ts` - Real snapshot builder coverage for Local, SSH, WSL, transitions and failed Cloud synchronization.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` - Owner action isolation, single-card Gateway tabs, selector state and refresh continuity.
- `redeven:desktop/scripts/check-environment-access-menu.mjs` - Adjacent Gateway and Cloud access actions, one group divider, unchanged card geometry, narrow layouts and keyboard traversal.

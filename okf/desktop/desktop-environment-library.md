---
type: Desktop Contract
title: Desktop Environment library
description: Browse one relationship card through independent Runtime and Cloud access perspectives, including Cloud source grids.
tags: [desktop, environment, cloud, welcome]
timestamp: 2026-09-19T00:00:00Z
---
# Summary

Welcome derives one Environment library from original snapshot owners. An exactly linked Runtime and Cloud Environment share one card with switchable access perspectives; an independent Runtime, URL, or Cloud Environment has one perspective. The Environment overview and Redeven Cloud source sections consume the same groups. Display grouping never merges registrations, grants permissions, selects another transport after failure, or changes an operation's owner. Unlinking restores independent cards; synchronization failures retain known Cloud environments with explicit stale-result context.

# Contract

## Relationship identity and projection

Pair Local, SSH, or WSL Runtime entries only when the Runtime link target ID equals the Cloud linked-runtime summary ID and Provider origin, Provider ID, and ENV ID all agree. Names, addresses, and online status do not establish identity. The snapshot builder emits display summaries while a complete exact binding is linking, linked, or disconnecting. Candidate occupancy and operation authorization retain their own strict binding rules; a display summary grants no authority. Unbound, unrelated, or missing counterparts remain independent.

Each group retains a stable primary Runtime ID, original owner references, member IDs, Cloud source identity, combined search content, and an any-owner pin result. A standalone Cloud group uses its Cloud entry ID. Build this projection once per snapshot; overview, source grids, filtering, layout, and summary counts consume it. Gateway management retains its separate projection and contract.

## Access perspectives and owner actions

Linked cards expose Runtime and Redeven Cloud as a compact segmented selector in the same header slot used by standalone type badges. Exactly one owner content area and action footer is visible. Overview defaults to Runtime; a Cloud source or Cloud filter defaults to Cloud. Pure Cloud cards use the same Cloud content with a type badge instead of a single tab. Runtime content retains host placement, version, startup age, and lifecycle actions. Cloud content presents source, ENV ID, public remote entry, and the existing remote action model; it has no speculative local version, startup age, or missing-Runtime placeholder.

Tab selection switches the name, status, facts, primary action, refresh, pin, settings, and Flower launch context. Tabs use distinct device, terminal, and cloud icons with a filled selected segment. Warning and progress badges supplement the access icon without replacing it; localized status text remains available to assistive technology and on hover. Cloud authorization or synchronization failure never disables Runtime actions. An existing Cloud window remains focusable while its authorization or remote-health warning stays visible and contributes to attention counts. Runtime actions never grant Cloud owners lifecycle or binding authority. Open uses the active owner's existing action model and never falls back to another perspective after a failure.

Selection belongs to the page session. Search and equivalent snapshots preserve it, including search temporarily hiding a card. Changing source filters resets to that scope's default, after which users can select either perspective. Switching tabs closes old menus and endpoint popovers without cancelling work. Already-open settings and Flower contexts remain bound to their original owner. Popovers, QR, focus, and progress use real owner IDs; perspective selection uses group IDs. Removing an owner prunes its selection and interactive surfaces. Stable owner and tab nodes preserve focus and selection across snapshot replacement.

Cards retain the existing responsive column model and share a compact header, facts area, and footer. Cards in each grid have equal heights and aligned action footers. Retained perspectives contribute to the same layout cell, so switching views does not change card height; the inactive perspective is invisible, inert, and hidden from assistive technology. Long identity and address values truncate with full details available; translated controls and enlarged text wrap without overlapping or hiding actions.

## Cloud sources and counts

Redeven Cloud presents one vertical section per source: compact account, address, synchronization status/time, refresh, reauthorization and removal controls, then that source's shared Environment grid. Each Cloud Environment appears once, including both linked Runtime pairs and pure remote environments. Source facts navigate directly to the corresponding Cloud section. Browsing either page creates no registration.

Search matches source name, account and address, plus group names, ENV IDs and connection information. A source match includes all its environments; an Environment-only match includes only matching groups. No connected sources, a successfully synchronized empty source, an unavailable initial catalog, and no search matches have distinct messages. Failed synchronization retains known cards and labels counts as the last synchronization result. Source statistics count groups, observed online Cloud owners, and actual linked Runtime groups.

Overview counts do not depend on the selected tab. Count each group once and sum windows by real member owner IDs. A group needs attention when any member needs attention. Running status uses Runtime health when a Runtime exists, otherwise the Cloud observation; readiness recognizes an available member. Either owner pin places the group in Pinned; pin controls affect only the active owner and explain when the other owner keeps the group pinned.

# Boundaries

[Environment registration ownership](desktop-environment-registrations.md) owns persisted records, serialized mutations and deletion. [Environment connections](desktop-environment-connections.md) owns address namespaces, popover and QR validity, and public versus private transport presentation. This library changes neither boundary and adds no persistence, IPC schema, Provider API, or Runtime API.

# Evidence

- `redeven:desktop/src/welcome/environmentLibraryProjection.ts` - Exact owner pairing and Cloud source membership.
- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Shared cards, stable perspectives, owner action and overlay control.
- `redeven:desktop/src/welcome/App.tsx` - Source sections, source navigation, and shared grid composition.
- `redeven:desktop/src/welcome/viewModel.ts` - Owner facts, actions, filtering and group summaries.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Display summaries preserve in-flight binding identity without changing candidate rules.
- `redeven:desktop/src/welcome/environmentRelation.test.ts` - Real snapshot builder coverage for Local, SSH, WSL, transitions and failed Cloud synchronization.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` - Owner action isolation, source search, pin scope and refresh continuity.
- `redeven:desktop/scripts/check-environment-relations.mjs` - Mixed grids, real browser actions, tab focus and ten-locale narrow/dark/enlarged-text acceptance.

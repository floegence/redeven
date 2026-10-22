---
type: Desktop Contract
title: Desktop Environment library
description: Browse one Runtime card through its original Runtime, Cloud and Gateway access tabs.
tags: [desktop, environment, cloud, welcome]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Welcome derives one Environment library from original snapshot owners. An exactly linked Runtime and Cloud Environment share one card with switchable access perspectives. Paired Gateways add one Gateway tab to this same Runtime card, with a member selector when needed; they do not add duplicate cards. Independent Runtime, URL and Cloud owners retain their cards. The Environment overview and Redeven Cloud source sections consume the same groups. Display grouping never merges registrations, grants permissions, selects another transport after failure, or changes an operation's owner. Unlinking restores independent cards; synchronization failures retain known Cloud environments with explicit stale-result context.

# Contract

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

## Relationship identity and projection
Pair Local, SSH, or WSL Runtime entries only when the Runtime link target ID equals the Cloud linked-runtime summary ID and Cloud origin, Cloud ID, and ENV ID all agree. The access-point origin is a route coordinate: directory changes cannot split the same Cloud environment into another card.

Current observed health takes precedence over historical open-window startup reports, and display continuity never restores live control authority.

## Access perspectives and owner actions
[Environment card presentation](desktop-environment-card-presentation.md) owns the original compact tabs, facts, split footer, responsive layout and focus continuity. Search and equivalent snapshots preserve selection, while source filters apply their scope's default once.

## Gateway perspective
Trusted Runtime membership summaries expose Gateway name, public endpoints, member identity, phase and whether the member owns Cloud publication. A single remaining member needs no selector; a later membership refresh cannot restore the retired selection.

## Environment action menu
The Environment card's action menu keeps direct Runtime operations in their existing order. If the fixed member has disappeared, confirmation cannot substitute another member. Without Gateway access, the existing menu order remains unchanged; unavailable actions retain their original capability and disabled-state checks.

## Cloud sources and counts
Redeven Cloud presents one vertical section per signed-in account, followed by its shared Environment grid.

The overview offers Refresh during normal operation or synchronization failure, and Sign in again when authorization expires.

Either owner pin places the group in Pinned; pin controls affect only the active owner and explain when the other owner keeps the group pinned.

# Boundaries

[Environment registration ownership](desktop-environment-registrations.md) owns persisted records, serialized mutations and deletion. Connection recovery diagnostics are transient Desktop snapshot fields; they do not change persistence, Provider API, Runtime API, or management authority.

# Evidence

- `redeven:desktop/src/main/environmentAccess.ts` - Authoritative connection ownership and preserved access defaults.

- `redeven:desktop/src/main/runtimeConnectionProjection.test.ts` - Raw Local/SSH/WSL observations, restricted Cloud management, offline catalogs, window deduplication and identity conflicts.

- `redeven:desktop/src/welcome/environmentLibraryProjection.ts` - One presentation of main-process ownership and Cloud source membership.

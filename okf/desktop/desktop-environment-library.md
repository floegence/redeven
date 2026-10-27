---
type: Desktop Contract
title: Desktop Environment library
description: Browse one Runtime card through its original Runtime, Cloud and Gateway access tabs.
tags: [desktop, environment, cloud, welcome]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Welcome projects one Environment library from authoritative snapshot owners. Exactly linked Runtime/Cloud entries share a card; paired Gateways add access tabs rather than duplicate cards. Independent Runtime, URL and Cloud owners retain their cards. Grouping never merges registrations, grants permission, substitutes failed transports or changes operation ownership. Unlinking restores independent cards; Cloud failures retain known environments with stale-result context.

# Contract

- The Environment header shows its title, description and actionable search/refresh/create controls, without an aggregate statistics row. Category filters retain their counts; cards retain individual Runtime/window states. A current snapshot issue remains visible below the description only while present, without reserving space in the normal header.
- Pair Local/SSH/WSL with Cloud only when linked Runtime ID, Cloud origin, Cloud ID and ENV ID agree. Access-point origin is routing metadata, so directory changes do not split identity. Current health outranks old window startup reports; retained display grants no control.
- [Card presentation](desktop-environment-card-presentation.md) owns tabs/layout. Search and equivalent snapshots preserve selection; source filters apply their default once. [Interaction continuity](desktop-interaction-continuity.md) owns drafts, authority, visibility and stale responses.
- Trusted Gateway summaries provide name, endpoints, member identity/phase and Cloud publication ownership. One member needs no selector. Refresh cannot restore a retired selection; confirmation cannot substitute a disappeared member. Existing menu order and capability checks remain authoritative.
- Redeven Cloud shows a section per signed-in account and shared grid. Offer Refresh normally or after synchronization failure, and Sign in again after expiry. Either owner pin places a group in Pinned; controls change only the active owner and explain the other owner's pin.

# Boundaries

[Registration ownership](desktop-environment-registrations.md) owns persistence, serialized changes and deletion. Recovery diagnostics are transient snapshots, not new persistence, API or management authority.

# Evidence

- `redeven:desktop/src/main/environmentAccess.ts` - Authoritative connection ownership and preserved access defaults.

- `redeven:desktop/src/main/runtimeConnectionProjection.test.ts` - Raw Local/SSH/WSL observations, restricted Cloud management, offline catalogs, window deduplication and identity conflicts.

---
type: UI Contract
title: Activity navigation restoration
tags: [ui, desktop, navigation, persistence]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

One Redeven Activity record selects the saved target before mounting and commits navigation/recency immediately. Legacy dynamic IDs remain pending until the current plugin directory can validate and migrate their stable target. Loading and cache authority follow [Env App resource snapshots](env-resource-cache.md).

# Contract

## Local record and migration
`activityNavigation` stores version 1 with a current target and `recentBuiltins`. Module placeholders read that same binding for view mode and layout; temporary lack of runtime metadata must not select a different preference store.

## Dynamic Activity pages
Only plugin instance, plugin, and surface identifiers are persisted. Execution plans, admission credentials, temporary URLs, and management revisions are resolved through the current plugin opening flow and never saved in navigation.

# Boundaries

A late restoration cannot replace explicit user navigation. Transient directory failure preserves the saved target for later startup or explicit retry; Floe does not write the product active-tab record.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/activityNavigation.ts` - Source.

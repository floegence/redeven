---
type: UI Contract
title: Activity navigation restoration
tags: [ui, desktop, navigation, persistence]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns exactly one versioned Activity navigation record. It selects the
saved target before the first page mounts, commits valid navigation immediately,
and remembers a unique recency order of built-in pages. Floe persists layout
sizes and collapse state but does not read or write the active tab. Invalid
dynamic targets fall back to the latest available built-in page, or Terminal.
A transient directory failure preserves the original saved target for a future
startup or explicit retry; a late restoration never replaces user navigation.

# Contract

## Local record and migration
`activityNavigation` stores version 1 with a current target and `recentBuiltins`. Module placeholders read that same binding for view mode and layout; temporary lack of runtime metadata must not select a different preference store.

Legacy dynamic IDs remain pending until the current plugin directory can validate and migrate their stable target.

## Dynamic Activity pages
Only plugin instance, plugin, and surface identifiers are persisted. Execution plans, admission credentials, temporary URLs, and management revisions are resolved through the current plugin opening flow and never saved in navigation.

Loading and cache authority follow [Env App resource snapshots](env-resource-cache.md).

# Boundaries

A late restoration cannot replace explicit user navigation. Transient directory failure preserves the saved target for later startup or explicit retry; Floe does not write the product active-tab record.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/activityNavigation.ts` - Versioned record, strict target projection, migration, and recency fallback.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Display-mode separation, inventory validation, and cancellation fences.

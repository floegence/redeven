---
type: UI Contract
title: Activity navigation restoration
description: Restore one locally saved Activity target before startup work and recover unavailable dynamic pages without stealing navigation.
tags: [ui, desktop, navigation, persistence]
timestamp: 2026-09-22T00:00:00Z
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

`activityNavigation` stores version 1 with a current target and `recentBuiltins`.
The UI preference binding partitions the record by stable environment and access
source. Desktop uses the native renderer storage scope, so changing loopback
ports and window IDs do not change the record's identity. This is small UI state,
separate from asynchronous resource snapshots and authorization credentials.
Browser startup uses the stable `env_local` preference binding before local
runtime discovery, matching navigation and subsequent reloads. Module placeholders
read that same binding for view mode and layout; temporary lack of runtime
metadata must not select a different preference store. Legacy navigation lookup
retains its original namespace solely for the one-time migration.

Built-in targets include Terminal, Monitor, Files, Codespaces, Web Services,
Host Applications, Containers, Flower, Settings, and Plugin Center. Connection
switchers, menus, and temporary floating windows are not navigation targets.
Workbench retains its existing display-mode and layout persistence independently;
opening or selecting Workbench content does not overwrite the Activity target.
Returning to Activity restores its last target, including Settings and Plugin
Center, unless the user explicitly asks to open another surface.

Read precedence is: a valid new record, a valid legacy Floe sidebar active tab,
a valid legacy `redeven_envapp_active_tab`, then Terminal. An invalid version,
malformed JSON, or unavailable storage cannot prevent startup. Successful
migration and subsequent navigation write only the new record. Local Web
Services is never rewritten to Codespaces. Legacy dynamic IDs remain pending
until the current plugin directory can validate and migrate their stable target.

## Dynamic Activity pages

Only plugin instance, plugin, and surface identifiers are persisted. Execution
plans, admission credentials, temporary URLs, and management revisions are
resolved through the current plugin opening flow and never saved in navigation.

A pending target remains selected while authenticated inventory discovery is
incomplete. After discovery, the Shell checks the instance, surface, current
permission, Activity pin, and supported placement. Missing, unpinned, removed,
or denied targets permanently fall back through built-in recency and update the
record. Activity plugin pages are not restored into unsupported mobile placement.

Network errors use existing plugin error handling and a temporary built-in
fallback, leaving the plugin target in storage. A new startup or explicit return
to Activity validates it again. A user page selection cancels pending restoration
and immediately commits the new target, including selection of the fallback
page itself. Asynchronous directory/open results are fenced by both the pending
target and current inventory owner.

Only the top-level Activity page is owned here. File paths, sessions, editor
contents, filters, and other page details keep their existing owners. Loading and
cache authority follow [Env App resource snapshots](env-resource-cache.md).

# Boundaries

A late restoration cannot replace explicit user navigation. Invalid dynamic destinations fall back to available built-in history or Terminal. Transient directory failure preserves the saved target for later startup or explicit retry; Floe does not write the product active-tab record.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/activityNavigation.ts` - Versioned record, strict target projection, migration, and recency fallback.
- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Initial target and published `persistActiveTab: false` layout ownership.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Display-mode separation, inventory validation, and cancellation fences.
- `redeven:internal/envapp/ui_src/src/ui/services/activityNavigation.test.ts` - Built-in matrix, malformed records, legacy precedence, stable native scope, and storage failure.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Startup selection and delayed/invalid/denied/failed dynamic restoration.
- `redeven:internal/envapp/ui_src/scripts/checkStartupContinuity.mjs` - Compiled Shell navigation reload matrix and cached startup frame observations.
- `redeven:desktop/scripts/check-startup-continuity.mjs` - Ten targets across actual Electron processes with changing ports and native UI storage.

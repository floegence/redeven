---
type: UI Contract
title: Terminal session groups
description: Persist one environment-wide terminal group catalog while Activity and Workbench render placement-specific trees.
tags: [ui, terminal, groups, activity, workbench, sqlite]
timestamp: 2026-08-25T00:00:00Z
---
# Summary

- Authority: the Runtime Terminal Group Catalog owns group identity, metadata, ordering, revision, and each live Session's single group assignment; browser views never derive or persist that assignment.
- Outcome: Activity and every Workbench Terminal show one consistent two-level group tree while retaining independent expansion state and Workbench widget placement.
- Invariants: `default` always exists, cannot be renamed or deleted, and every client-visible Session has exactly one known `group_id`; a Group path affects only new Session startup.
- Failure boundary: stale responses cannot regress the catalog, unknown groups trigger a refresh without reassignment, and Group deletion closes or safely hides every member before removing the Group.

# Contract

## Catalog and Session assignment

Redeven owns `apps/terminal/groups.sqlite` as a versioned product database. It stores Group ID, display name, default working directory, order, timestamps, and one monotonic catalog revision. Startup opens and verifies this catalog before Terminal requests are accepted and atomically creates the fixed `default` Group at the Environment Home on first use. Future versions, wrong kinds, and schema drift fail closed without replacing the file. Group names are required, contain at most 64 Unicode characters, and are unique case-insensitively. A default path must resolve to an existing absolute directory inside the current filesystem permission scope.

Session membership is runtime-only because Terminal Sessions do not survive the owning process. The Terminal manager resolves a requested Group before spawning, substitutes that Group's default path only when the create request has no explicit working directory, records membership before publishing the created lifecycle event, and includes `group_id` in every create/list result. Later shell directory changes update Session metadata and local-path capability but never alter Group membership or the Group default. Duplicate Session creates preserve the source Group and its current authorized working directory. A missing or deleting Group rejects create and move; the client does not synthesize a Default assignment.

The Terminal protocol uses contiguous RPC type IDs 2017 through 2022 for list, create, update, delete, Session move, and catalog notification. Catalog responses, mutations, moves, and notifications carry the monotonic revision. Clients accept only a strictly newer catalog snapshot, bind mutations to the Environment, connection epoch, and operation identity, and request one deduplicated refresh when a notification or Session references newer or unknown catalog state.

## Activity, Workbench, and view-local state

One Terminal Session Catalog Provider owns the browser projection for the Environment. Activity groups every visible Environment Session. Every Workbench Terminal widget renders all Groups but filters each Group's children through that widget's persisted `session_ids`. Moving a Session between Groups updates only catalog membership; it does not move the Session between Workbench widgets, replace its Terminal runtime, transfer controller ownership, resize it, reconnect its PTY, or discard semantic history.

Workbench state continues to store only Session placement and terminal geometry. It never stores Group metadata or membership. Consequently, renaming, moving, or folding a Group is immediately consistent across all mounted surfaces without a Workbench schema change. Activity and each Workbench widget persist their own collapsed Group IDs under an Environment-and-panel-scoped UI preference key, so one view's disclosure choice does not affect another. Search matches Group name, Group path, and Session presentation; a matching folded child is revealed temporarily without changing that saved preference.

## Interaction and asynchronous lifecycle

The sidebar renders Group headers with explicit expand/collapse, create-Session, edit, and allowed delete actions. Children retain the existing Session identity, status, unread attention, path, active edge, keyboard access, and quick actions in a compact desktop row; mobile keeps the larger touch row. Pointer drag and the keyboard/context action call the same move operation.

Create, update, move, and delete are locally optimistic and scoped to the affected Group or Session. A pending Session appears before the spawn RPC, a move changes only tree placement, and confirmed deletion hides the Group and all members in every mounted projection without blocking unrelated Terminal controls. A failed current operation rolls back from its captured revision and schedules authoritative refresh; a response from an old Environment, connection, or operation is inert. Concurrent Group closes use a bounded worker set rather than serial browser work.

Deleting a non-Default Group always requires confirmation containing the Environment-wide member count and the Activity/Workbench consequence. The manager first prevents new creates or moves into the Group, then invokes the standard asynchronous close lifecycle for every member. Closed and safely hidden Sessions emit the existing lifecycle events, whose product hook removes references from every Workbench widget, including widgets not currently mounted. The Group is deleted only after the close attempts settle. Individual failures are returned as explicit Session IDs; those Sessions remain hidden, no success is fabricated, and no silent retry loop is introduced.

# Boundaries

Group membership is not Workbench placement, shell working directory, controller ownership, attachment identity, or persistent Session recovery. No Activity or Workbench component may maintain a second membership map, infer membership from paths, or repair an unknown Group by changing a Session to Default. Group disclosure and metadata updates remain renderer-neutral UI state and must not remount `TerminalSessionRuntime`.

# Evidence

- `redeven:internal/terminal/group_catalog.go` - Owns the revisioned catalog, protected Default Group, and atomic product mutations.
- `redeven:internal/terminal/group_catalog_schema.go` - Defines and verifies the v1 SQLite schema through the shared migration engine.
- `redeven:internal/terminal/groups.go` - Resolves paths, serializes membership changes and deletion, bounds closes, and registers RPC 2017-2022.
- `redeven:internal/terminal/group_catalog_test.go` - Covers persistence, schema rejection, validation, assignment, move/delete serialization, bounded close, and partial failure.
- `redeven:internal/codeapp/workbench_terminal_sessions.go` - Removes closed or hidden Sessions from every Workbench widget state.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalSessionCatalog.tsx` - Owns the shared revision-fenced browser projection and optimistic operations.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionNavigator.tsx` - Renders the accessible compact Group tree and common drag/action move paths.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx` - Projects Activity or Workbench placement without changing mounted Session runtimes.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalSessionCatalog.test.tsx` - Proves optimistic updates, rollback, and revision fencing alongside existing catalog behavior.

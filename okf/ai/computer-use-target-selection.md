---
type: AI Tool Contract
title: Computer target selection across threads
description: Resolve logical targets without side effects and preserve each authorized thread selection across turns and restart.
tags: [ai, computer-use, targets, permissions]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

The Computer Use Runtime owns discovery and selection over Redeven product
settings. Users describe work; Flower finds the browser page or application
window. The current selection is a working position, not a requirement to bind
resources in settings. Candidates never grant access. Stale, disconnected or
occupied resources fail explicitly without changing the previous selection.

# Contract

## Discovery and selection

`computer.targets` lists browser profiles/pages and application windows without
a preselected target. `browser_source` is `auto`, `system`, or `managed`. Explicit
system/personal-browser tasks use `system`, which excludes managed and native
window candidates and never starts a managed profile. Missing connections produce
formal connection assistance. `auto` retains the current-page, unique-personal,
managed-default policy; one shared profile rule serves discovery and direct use.
It returns bounded Runtime-issued `candidate_ref` values,
page titles, URLs, profile names, actual opener identities and availability.
References are thread-scoped, expire after ten minutes and exist only in bounded
Runtime memory. A native Chrome window is a desktop window, not a browser page.

`computer.select_target` consumes one candidate. Resource resolution is read-only;
connection and new-page creation occur after Floret authorization. Selection
rechecks inventory identity, current permissions and resource occupancy, prepares
the adapter, and binds the existing product setting under the target gate. The
UI uses this same selection implementation. No model-supplied endpoint, window
identity, origin grant or control ownership is accepted through the candidate API.
A changed title/URL requires fresh discovery rather than a silent substitute.

## Default work and explicit switching

For `current`, the Runtime reads the thread's `computer_target_id`. An existing
selection must still resolve to that exact resource. An unbound web task plans
an independent background page in the single connected personal browser profile
(extension or previously authorized CDP). With no personal connection it uses
the default managed profile. Multiple personal profiles require a task-informed
choice from inventory or one conversational clarification; there is no arbitrary
profile selection. Read-only planning creates neither pages nor bindings.

A profile participates in the default target identity. A connection change cannot
silently replace an authorized resource. Preparation serializes page creation,
so simultaneous operations for one task reuse its page while separate tasks
receive distinct pages. Existing-page tasks select the matching inventory entry
without reloading it or losing an unsaved form.

Explicit switching releases prior execution resources and requires a new
observation. Site/app permissions still apply at observation and action time.
Selection cannot bypass Stop or private user control. `TARGET_IN_USE` denotes
another active owner; it is distinct from insufficient permission. A rejected
selection leaves the previous binding and ownership intact. Confirmed actions
remain confirmed even if later work fails; no click or partial script is replayed.

The connection panel shows the current page/application and connection state.
Optional switching groups searchable browser pages and application windows;
connection setup stays behind Manage connections. Real ambiguities are resolved
in the conversation. Full access hides redundant per-resource grant controls.

## Persistence and fork

The migrated product store remains the only selection store. No schema change,
Agent lifecycle mirror or durable candidate cache is introduced. The existing
version 6-to-7 selection, 7-to-8 pin ranking and 8-to-9 access migrations remain
intact. Floret storage is opaque and its published v7.16.1 authorization, results,
Activity and interaction contracts require no upstream API expansion.

Restart restores selection identity, not helper liveness or control. A lost task
page fails until a fresh candidate is selected. New and forked threads start
unbound, have independent task pages and inherit no parent resource authority.
Forks start with empty computer grants. Deleting product settings removes the
selection and grants; a later bind never recreates a deleted thread.

# Boundaries

Task access contains exact allowed origins, application identities and temporary
foreground permission. The authenticated endpoint requires thread authority and
read/write/execute permission to change it. The migrated product store is its
single owner. A settings change retires active script execution; every following
operation reloads current access. The script cannot submit its own grant fields.

Focused tests cover switching, thread isolation, rejected actions, storage failure,
restart, fork, access migration and deletion. The [takeover contract](computer-use-takeover.md)
owns active shared-target control. Persisted preference or grants alone cannot
prove readiness, foreground safety or platform qualification.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - read-only resolution and store binding.
- `redeven:internal/ai/run.go` - authorized selection before adapter dispatch.
- `redeven:internal/ai/target_registry.go` - deterministic identity resolution.
- `redeven:internal/ai/computer_target_binding_test.go` - switching and failure boundaries.
- `redeven:internal/ai/threadstore/computer_target_test.go` - migration, rollback and restart.
- `redeven:internal/ai/threadstore/computer_access_test.go` - contiguous access migration and fork isolation.
- `redeven:internal/ai/computer_access.go` - current authorization and active-script revocation.

- `redeven:internal/ai/computer_candidates.go` - bounded candidate identities and shared selection.
- `redeven:internal/ai/computer_autonomous_integration_test.go` - real Chromium through the production Floret tool loop.
- `redeven:internal/flower_ui/src/FlowerComputerConnections.tsx` - optional grouped target switcher.

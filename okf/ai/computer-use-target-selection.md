---
type: AI Tool Contract
title: Computer target selection across threads
description: Resolve logical targets without side effects and preserve each authorized thread selection across turns and restart.
tags: [ai, computer-use, targets, permissions]
timestamp: 2026-09-20T00:00:00Z
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

Live browser inventory owns page availability. Registered adapters preserve
identity, but their cached descriptors cannot keep a closed page available.
Restricted discovery also reads live inventory, then exposes only allowed
registered identities, without offering new pages. A disconnected managed
Chromium process is retired during discovery; this read neither starts a
replacement nor changes the saved selection. An eligible new-page candidate stays
available while the capability is enabled. Authorized selection starts an installed
Chromium through the existing profile owner, or produces the canonical
[installation consent request](computer-use-browser-installation.md) when absent.
Disabled managed browsers are excluded from candidates and default planning;
existing references cannot dispatch browser tools. The built-in profile is described as headless Chromium, without exposing
its internal Default name as a separate setup choice.

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

The shared Browser and desktop dialog shows the saved current page/application.
A missing saved identity remains unavailable; it never appears as an unselected
automatic task. One searchable picker groups browser pages and application
windows. A radio choice is a local draft until the user confirms; cancellation
performs no binding. Rejected selections retain the previous binding and require
fresh discovery when identity changed. A lost selection response is unconfirmed;
users refresh inventory to inspect the current binding, without retrying the write. Advanced endpoint discovery uses this same
picker and never connects a page by itself. Real ambiguities are resolved in the
conversation. Environment setup and permissions follow the
[environment settings contract](computer-use-environment-settings.md).

## Persistence and fork

The migrated product store remains the only selection store. No schema change,
Agent lifecycle mirror or durable candidate cache is introduced. The existing
version 6-to-7 selection, 7-to-8 pin ranking and 8-to-9 access migrations remain
intact. Floret storage is opaque and its published v7.16.1 authorization, results,
Activity and interaction contracts require no upstream API expansion.

Restart restores selection identity, not helper liveness or control. A lost task
page fails until a fresh candidate is selected. Flower recovers through discovery,
selection and a fresh observation, without directing a remote user to restore the
desktop or configure a target. It reuses a matching live page or, for ordinary web
work, opens an eligible page and navigates to the task URL. Explicit browser and
account requirements, Stop, private control and completed effects remain binding.
Missing account access or unsaved page content is explained in the conversation;
recovery never claims to restore unsaved forms or replays an unknown effect.
New and forked threads start unbound, have independent task pages and inherit no
parent resource authority.
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

- `redeven:internal/ai/computer_candidates.go` - live browser inventory, bounded candidate identities and shared selection.
- `redeven:internal/ai/computer_managed_browser_test.go` - real closed-page and browser-crash recovery without discovery side effects.
- `redeven:internal/ai/prompt_builder.go` - task-led recovery and browser/account boundaries.
- `redeven:internal/ai/computer_autonomous_integration_test.go` - real Chromium through the production Floret tool loop.
- `redeven:internal/flower_ui/src/FlowerComputerConnections.tsx` - staged grouped target picker.

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerDialog.browser.test.tsx` - cancellation, stale selection, thread changes and keyboard switching.

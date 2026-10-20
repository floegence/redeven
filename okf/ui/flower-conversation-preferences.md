---
type: UI Contract
title: Flower personal conversation preferences
description: Remember explicit model, directory, and model-owned reasoning choices without importing thread settings into future defaults.
tags: [ai, flower, preferences, composer, persistence]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Flower remembers explicit choices for future root conversations in one
Redeven-owned product store, scoped by authenticated namespace, endpoint, and
user. The existing controls and layout are unchanged. Loading or switching a
Thread never writes a preference. Existing Threads and immutable Turns keep
their own confirmed settings; new conversations use explicit launch/draft
choices before personal memory and configured defaults.

# Contract

## Ownership and persistence

`ai_conversation_preferences` belongs to `ai_threadstore_product_v1`, schema
version 11. The v10-to-v11 transactional migration validates both historical
and target shapes, preserves product data, and never infers a user's preference
from old Threads. No Floret lifecycle or SQL authority is duplicated.

The record stores model identity, real absolute working directory, a reasoning
selection map keyed by full model identity, and revision. Desktop identities
are the existing deterministic opaque IDs, not session IDs or new physical
machine identities. AIConfig remains the environment configuration fallback;
ordinary Flower choices do not change it. No credentials enter this record.

The mandatory personal-preferences API is paired by Runtime compatibility
epoch 66; older peers use the existing upgrade path rather than silently
falling back to environment defaults. Runtime Service protocol stays v2.

GET/PATCH `/_redeven_proxy/api/ai/conversation_preferences` derive ownership
from authenticated session metadata. Reads require read access; writes require
read/write/execute. PATCH rejects unknown fields, trailing JSON, missing
revision, empty patches, invalid models, unauthorized directories, and invalid
reasoning. Model authorization and capability validation run again on root
creation. Stable scope absence cannot read another user's defaults.

## Selection events

Only the selected field is patched. Model edits remember the model, reasoning
edits remember that model's full selection including budget, and picker
confirmation remembers the server-validated real directory. A same-value
model or reasoning choice is still an explicit event and may skip the redundant
Thread mutation. Existing-Thread edits must succeed before personal memory is
changed; a later memory failure does not roll back the confirmed Thread result.

Loading, navigation, reconnect, capability normalization, sending, fork, child
creation, retry, and directory browsing/cancellation do not remember values.
Reasoning selected on model B does not make B the next default model or copy
B's working directory. Explicit Default remains distinct from absent memory;
existing Default/budget and Off/budget semantics are unchanged.

## Drafts and admission

Shared drafts separate explicit `model_id_override`/`working_dir_override`
from effective `model_id`/`working_dir` admission projections. Explicit reasoning
has a `reasoning_model_id` owner. When editing begins, `inherited_defaults`
freezes inherited model/directory/reasoning defaults without creating a
preference event. Remount and session-restart export preserve that snapshot.
A true New action clears transient overrides and inherited defaults and uses
the latest personal memory. Old Thread selection cannot seed the new draft.

Env App and Desktop adapters load personal defaults with settings before chat
readiness, and standalone/Ask Flower launches prefer remembered models before
configured defaults. One-shot directory/context parameters retain priority
without being remembered. Goal root creation shares the current resolved
settings. Ask Flower prepares model, real/default directory, permission, and
full reasoning selection once per request; an unknown-admission retry keeps
that prepared input rather than reading later preferences. Admission freezes
the request; uploads, later selections, and outbox retry cannot reinterpret it.
A new draft also sends remembered reasoning whose capability became invalid,
so admission rejects the intent instead of silently dropping it.

Unavailable remembered intent remains unavailable: missing model authorization,
Desktop binding/catalog, removed directory, or changed reasoning capability
must fail explicitly rather than silently switching model source or Home.
Existing busy/queued/unresolved-interaction edit restrictions are unchanged.

## Concurrency and failure

Each authenticated adapter orders captured field patches and loads the latest
revision before writing. The product store atomically merges fields and uses
compare-and-set revision; concurrent stale writes return HTTP 409 and are not
automatically retried. Failed writes do not block later intentional choices.
Reads, including waiting behind earlier writes, share the 15-second deadline.
Writes use the existing 120-second response deadline; timeout releases the queue
without replaying the uncertain write. The next intentional choice reads a fresh
server revision. Lifetime disposal and permission withdrawal prevent queued work
from dispatching. An already dispatched write can finish at the server; ending
its local wait never claims that write was cancelled.

Response acceptance checks adapter identity, disposal, read generation and
monotonic preference revision. Settings-dependent editing remains disabled until
the current complete settings read succeeds. See the [startup and settings
recovery contract](../architecture/flower-startup-presentation.md).
Thread/draft targets and model identities are captured before asynchronous work;
a late response cannot retarget another draft or navigate the surface.

# Boundaries

This is Redeven product preference policy using already published Floret
capabilities, not a generic upstream settings framework. Runtime catalogs,
filesystem scope, canonical Thread settings, and immutable Turn execution remain
authoritative. Model and directory recovery use existing controls and host
notifications, not new switches, save buttons, or confirmation dialogs.

# Evidence

- `redeven:internal/ai/conversation_preferences.go` - Authenticated product preference API and model/directory/reasoning validation.
- `redeven:internal/ai/threadstore/conversation_preferences.go` - Scoped transactional field merge, revision conflict, and v11 migration.
- `redeven:internal/ai/threads.go` - Root creation precedence and final validation.
- `redeven:internal/codeapp/appserver/server.go` - Strict GET/PATCH and permission/audit boundaries.
- `redeven:desktop/src/main/runtimeFlowerRoutes.ts` - Desktop permits only GET/PATCH without caller-supplied scope queries; authenticated Runtime scope remains authoritative.
- `redeven:internal/flower_ui/src/conversationPreferences.ts` - Shared one-shot launch resolution and ordered captured patches without conflict replay.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Explicit event handlers, frozen draft defaults, and immutable launch resolution.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Explicit/projection separation and restart preservation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.conversationPreferences.browser.test.tsx` - Thread isolation, same-value choices, directory confirmation, remount, and late failure coverage.
- `redeven:internal/ai/threadstore/schema_v11_test.go` - Preservation, rollback, and concurrent-writer single-winner tests.
- `redeven:internal/codeapp/appserver/conversation_preferences_test.go` - Permissions, strict JSON, scope isolation, and revision conflict.

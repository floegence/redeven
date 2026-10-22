---
type: UI Contract
title: Flower personal conversation preferences
description: Remember explicit model, directory, and model-owned reasoning choices without importing thread settings into future defaults.
tags: [ai, flower, preferences, composer, persistence]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
`ai_conversation_preferences` belongs to `ai_threadstore_product_v1`, schema version 11. The v10-to-v11 transactional migration validates both historical and target shapes, preserves product data, and never infers a user's preference from old Threads.

Stable scope absence cannot read another user's defaults.

## Selection events
Only the selected field is patched. Existing-Thread edits must succeed before personal memory is changed; a later memory failure does not roll back the confirmed Thread result.

Explicit Default remains distinct from absent memory; existing Default/budget and Off/budget semantics are unchanged.

## Drafts and admission
Shared drafts separate explicit `model_id_override`/`working_dir_override` from effective `model_id`/`working_dir` admission projections. Old Thread selection cannot seed the new draft.

Existing busy/queued/unresolved-interaction edit restrictions are unchanged.

## Concurrency and failure
Each authenticated adapter orders captured field patches and loads the latest revision before writing. The product store atomically merges fields and uses compare-and-set revision; concurrent stale writes return HTTP 409 and are not automatically retried.

Thread/draft targets and model identities are captured before asynchronous work; a late response cannot retarget another draft or navigate the surface.

# Boundaries

This is Redeven product preference policy using already published Floret capabilities, not a generic upstream settings framework. Runtime catalogs, filesystem scope, canonical Thread settings, and immutable Turn execution remain authoritative. Model and directory recovery use existing controls and host notifications, not new switches, save buttons, or confirmation dialogs.

# Evidence

- `redeven:internal/ai/conversation_preferences.go` - Authenticated product preference API and model/directory/reasoning validation.

- `redeven:internal/ai/threadstore/conversation_preferences.go` - Scoped transactional field merge, revision conflict, and v11 migration.

- `redeven:internal/ai/threads.go` - Root creation precedence and final validation.

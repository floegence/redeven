---
type: UI Contract
title: Flower conversation references
description: Add frozen conversation facts to the current draft and preview or navigate without losing user input.
tags: [flower, composer, references, interaction]
timestamp: 2026-10-14T00:00:00Z
---
# Summary

The existing composer draft owner stores unadmitted thread references; Floret owns
admitted snapshots. Reference this conversation appends only basic facts to the
current editor, preserves selection and input, and never sends automatically.
Thread identity includes its runtime. Authorized Open selects only after a valid
read. Failed or canceled reads retain the preview and draft; frozen transport
retries retain the original snapshot after source rename or deletion.

# Contract

The list's right-click, More and keyboard menu append a thread reference to the
current draft without selecting the source or sending. With no selection, the
new-conversation draft owns it. The draft keeps its text, files and other
references. Identity is `(runtime_id, thread_id)`; repeated selection does not
refresh the frozen snapshot, and self-reference is supported.

Exactly eight fields are captured: runtime and thread identity, title, status,
working directory, creation, update and capture timestamps. Message previews and
history are excluded. The shared type dispatch owns identity, serialization and
visible description; a thread is never treated as a filesystem path. The chip
shows a conversation icon, title and remove button. Preview uses the existing
snapshot window, with localized basic information and Open conversation. Close
restores its opener's focus. Open performs an authorized read before selection;
a failed read or closed pending preview leaves the current conversation and
draft intact. Historical snapshots remain readable after source deletion.

Question, approval, read-only and preparing/frozen input states keep the menu
item visible with a localized disabled explanation. Navigation and New remain
available. An ordinary running thread can receive references through its normal
queue. Ordinary sends retain references in the editor until admission; queued
sends consume the frozen references immediately with the submitted draft.
Consumption matches both local ID and full snapshot value, preserving newer
reference edits. A definite transport failure restores queued text, references
and files only when the original scope has no newer draft.
Otherwise the existing frozen outbox and recovery controls retain the submission.
A retry resends the frozen input rather than refreshing source metadata. Admitted queued conversation references also appear in the compact queue preview strip and can be retained or removed in the [shared queue editor](flower-turn-launcher.md); editing does not refresh their captured basic snapshot.

Only `flower_composer` accepts `thread_reference` with a strict nested `thread`
snapshot. First admission checks readable source metadata in the current runtime
and namespace. Local UI endpoint `env_local` has one reference/runtime identity,
`env:local-environment`, shared by Desktop and Env App; remote identities remain
`env:<endpoint_id>`. The shared UI identity owner supplies adapter, router and
live-mapper identities so the carrier cannot change reference admission.
Replay compares canonical frozen input even after rename or
delete. One Floret `MessageReferenceThread` stores the target ID, label and JSON
snapshot; there is no parallel context copy. References supply facts, never
permission. [Canonical thread queries](../ai/flower-thread-queries.md) owns how
Flower reads further information through authorized tools.

# Boundaries

A reference is user-supplied information, never authority or execution location.
One draft coordinator, strict context action and canonical Floret reference own
the workflow; there is no independent draft or admitted mapping store.
[Composer references](flower-composer-references.md) owns shared chip and file
interaction, and [thread queries](../ai/flower-thread-queries.md) owns content access.

# Evidence

- [Shared surface](../../internal/flower_ui/src/FlowerSurface.tsx), [reference type dispatch](../../internal/flower_ui/src/composer/flowerDraftReferenceModel.ts) and [thread menu](../../internal/flower_ui/src/threads/FlowerThreadList.tsx).
- [Strict context action](../../internal/flower_ui/src/contextActionWire.ts) and [admission authorization](../../internal/ai/thread_reference.go).
- [Shared runtime identity](../../internal/flower_ui/src/flowerRuntimeIdentity.ts) and [Env App adapter regression](../../internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts).
- [Browser interaction tests](../../internal/envapp/ui_src/src/ui/FlowerSurface.threadReferences.browser.test.tsx) and [canonical replay tests](../../internal/ai/thread_reference_query_test.go).

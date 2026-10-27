---
type: UI Contract
title: Flower conversation references
description: Add frozen conversation facts to the current draft and preview or navigate without losing user input.
tags: [flower, composer, references, interaction]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The existing composer draft owner stores unadmitted thread references; Floret owns
admitted snapshots. Reference this conversation appends only basic facts to the
current editor, preserves selection and input, and never sends automatically.
Thread identity includes its runtime. Authorized Open selects only after a valid
read. Failed or canceled reads retain the preview and draft; frozen transport
retries retain the original snapshot after source rename or deletion.

# Contract

The list's right-click, More and keyboard menu append a thread reference to the current draft without selecting the source or sending.

The shared type dispatch owns identity, serialization and visible description; a thread is never treated as a filesystem path.

[Canonical thread queries](../ai/flower-thread-queries.md) owns how Flower reads further information through authorized tools.

# Boundaries

A reference is user-supplied information, never authority or execution location. [Composer references](flower-composer-references.md) owns shared chip and file interaction, and [thread queries](../ai/flower-thread-queries.md) owns content access.

# Evidence

- [Shared surface](../../internal/flower_ui/src/FlowerSurface.tsx), [reference type dispatch](../../internal/flower_ui/src/composer/flowerDraftReferenceModel.ts) and [thread menu](../../internal/flower_ui/src/threads/FlowerThreadList.tsx).

- [Shared runtime identity](../../internal/flower_ui/src/flowerRuntimeIdentity.ts) and [Env App adapter regression](../../internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts).

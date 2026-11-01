---
type: UI Contract
title: Flower conversation references
tags: [flower, composer, references, interaction]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

The composer owns unadmitted references; Floret owns admitted snapshots. Reference appends basic facts without sending or disturbing selection. Identity includes Runtime and Open requires authorized reads. Failed/canceled reads retain draft/preview; transport retries keep the frozen source even after rename/deletion.

# Contract

The list's right-click, More and keyboard menu append a thread reference to the current draft without selecting the source or sending.

The shared type dispatch owns identity, serialization and visible description; a thread is never treated as a filesystem path.

[Canonical thread queries](../ai/flower-thread-queries.md) owns how Flower reads further information through authorized tools.

# Boundaries

A reference is user-supplied information, never authority or execution location. [Composer references](flower-composer-references.md) owns shared chip and file interaction, and [thread queries](../ai/flower-thread-queries.md) owns content access.

# Evidence

- [Shared surface](../../internal/flower_ui/src/FlowerSurface.tsx), [reference type dispatch](../../internal/flower_ui/src/composer/flowerDraftReferenceModel.ts) and [thread menu](../../internal/flower_ui/src/threads/FlowerThreadList.tsx).

- [Shared runtime identity](../../internal/flower_ui/src/flowerRuntimeIdentity.ts) and [Env App adapter regression](../../internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts).

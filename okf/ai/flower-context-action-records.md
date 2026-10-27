---
type: AI Context Contract
title: Flower context action admission
description: Ask Flower context actions become Floret-owned message references and durable model-context snapshots at admission.
tags: [ai, flower, context]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns selected context before admission; Floret owns admitted messages/references/context. One mapper validates authorization/privacy then emits durable ordered MessageReference and UserInput.Context. No product copy persists afterward. Malformed/unknown/forged or failed projection rejects admission while preserving editable draft/references.

# Contract

Clients send one `assistant.ask.flower` action with target, source, presentation, and typed context items. The runtime validates the source/kind privacy matrix: file surfaces use `file_path`, terminal uses `terminal_selection`, monitoring uses `process_snapshot`, and Git/environment producers use bounded `text_snapshot`.

Neither path reconstructs references from a product context-action copy.

# Boundaries

Context actions and references do not alter working directory, target permission, tool routing authority, or attachment ownership. A model that acts on environment routing metadata must use the Redeven product command boundary, which resolves and authorizes the target independently. Missing thread or reference maps to absence; other Floret errors remain unavailable and never trigger a product-state fallback.

# Evidence

- `redeven:desktop/src/welcome/environmentFlowerContext.ts` - Bounded, redacted environment inspection and card-owned operation capture.

- `redeven:desktop/src/welcome/environmentFlowerContext.test.ts` - State distinctions, owner isolation, failure diagnostics, omission, Unicode bounds, and shared wire fixture.

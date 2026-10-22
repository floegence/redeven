---
type: UI Contract
title: Flower composer references
description: Show Ask Flower context inside the input and admit exact ordered composer references to Floret.
tags: [ui, flower, composer, references, floret]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Redeven owns reference discovery and unadmitted draft editing; Floret is the sole canonical source after admission.
- Outcome: The input shows linked context, `@` files, frozen conversation references and optional origin-page facts.
- Invariants: discovery uses the host's authorized filesystem adapter, all visible placements in one connection share one in-memory scope, and one strict context action preserves the frozen order and directory kind.
- Failure boundary: stale search generations, malformed wire data, or admission mismatches fail without discarding the connection-local editor, creating a different queued command, or writing canonical Floret state.

# Contract

## Ask Flower context
The shared launcher and embedded Tessiven composer show linked context inside their existing composite input boundary.

Chips sit side by side, wrap and scroll inside a bounded input region under the host's existing local-scroll contract.

Editable `@` references keep their existing controls.

## Composer interaction
The full composer recognizes an editable `@` token only at a whitespace boundary with a collapsed caret.

Composer focus preserves the same one-pixel geometry and shadow, changing only to a restrained border color; candidate and directory-action focus-visible states remain explicit.

## New conversation origin page
[Activity origin page references](flower-page-context.md) owns opening/New capture, authorized page readers, layout scope and removal. Host snapshot presentation is injected without transferring draft or canonical-reference authority; Env App reuses the right-click Ask Flower preview window and text viewer for both editable and submitted snapshots.

## Conversation references
[Conversation reference interaction](flower-thread-references.md) owns frozen basic snapshots, menu entry points, preview, removal and submission recovery. The same draft owner and type dispatch support thread, page and file references.

## Bounded discovery
Discovery searches the current thread's immutable working directory or the new-thread working-directory draft.

A token without a slash uses that bounded global matching behavior. Root read errors are visible and retryable; inaccessible descendants are skipped within the same bounded scan.

## Draft and admission
The connection-local composer stores ordered file/directory, page-context and thread chips with a product-local identity and host-derived label. This editable draft is never written to Redeven, Floret, local storage, IndexedDB, or another connection.

After admission, the one-pass mapping defined by [AI tool runtime](../ai/ai-tool-runtime.md) gives Floret the canonical ordered `MessageReference` values and turn context snapshots.

## Queue previews and editing
Canonical queue references remain visible as compact icons and use exact ThreadID, QueueID and ReferenceID for file/directory preview. New submission repeats normal authorization and admission; display labels never reconstruct opaque resource authority.

# Boundaries

Search results and persisted paths are display and navigation metadata, not filesystem authorization.

After Send, only the browser transport outbox may retain the original ordinary launch payload until canonical confirmation or terminal cleanup; the product-local chip identity and label are not canonical identity or admission authority. Once admitted, Redeven does not retain a second queryable message-reference record, and canonical reference presentation and navigation derive from Floret reads plus current host authorization.

# Evidence

- `redeven:internal/flower_ui/src/composer/FlowerComposerContextReferences.tsx` - Compact removable chips reuse the input boundary and restore keyboard focus.

- `redeven:internal/flower_ui/src/composer/removeFlowerTurnLauncherReference.ts` - Removal keeps display, action and consolidated attachment identities aligned.

- `redeven:internal/flower_ui/src/FlowerTurnLauncherPanel.test.tsx` - Exact removal and submission, frozen retry context, selection previews and consolidated snapshots.

---
type: UI Contract
title: Flower composer references
tags: [ui, flower, composer, references, floret]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns authorized reference discovery and unadmitted connection-local drafts; Floret owns ordered references after admission. Composer chips show files/directories, frozen conversation references and page context. Stale discovery preserves the editor; captured submission failures retain outbox recovery without overwriting newer edits; labels never supply canonical identity or authorization.

# Contract

## Ask Flower context
Launcher and Tessiven composers show linked chips inside their composite input. Chips wrap/scroll within a bounded region under local-scroll rules; editable `@` references retain controls.

## Composer interaction
An editable `@` token requires whitespace boundary and collapsed caret. Focus changes a restrained border color, preserving one-pixel geometry/shadow and explicit candidate/action focus indicators.

## New conversation origin page
[Page context](flower-page-context.md) owns opening/New capture, authorized readers, scope and removal. Env App reuses Ask Flower's preview/text viewer for draft and submitted snapshots without transferring draft authority.

## Conversation references
[Thread references](flower-thread-references.md) own frozen snapshots, menus, preview, removal and recovery under the shared draft owner.

## Bounded discovery
Search uses immutable thread working directory or the new-thread directory draft. Slashless tokens use bounded global matching. Root read failures are retryable; inaccessible descendants are skipped within the same bounded scan.

## Draft and admission
Ordered file/directory/page/thread chips have local identities/host labels and stay in connection memory, never persistence or another connection. [Tool runtime](../ai/ai-tool-runtime.md) defines one-pass canonical `MessageReference`/context admission.

## Queue previews and editing
Compact queue references preview by exact ThreadID/QueueID/ReferenceID. Resubmission repeats authorization/admission; labels cannot reconstruct resource authority.

# Boundaries

Search results and persisted paths are display and navigation metadata, not filesystem authorization.

After Send, only the browser transport outbox may retain the original ordinary launch payload until canonical confirmation or terminal cleanup; the product-local chip identity and label are not canonical identity or admission authority. Once admitted, Redeven does not retain a second queryable message-reference record, and canonical reference presentation and navigation derive from Floret reads plus current host authorization.

# Evidence

- `redeven:internal/flower_ui/src/composer/FlowerComposerContextReferences.tsx` - Compact removable chips reuse the input boundary and restore keyboard focus.

- `redeven:internal/flower_ui/src/FlowerTurnLauncherPanel.test.tsx` - Exact removal and submission, frozen retry context, selection previews and consolidated snapshots.

---
type: UI Contract
title: Flower composer references
description: The full Flower composer discovers working-directory files and directories through @, persists editable draft chips, and admits exact ordered references to Floret.
tags: [ui, flower, composer, references, floret]
timestamp: 2026-07-27T00:00:00Z
---
# Summary

- Authority: Redeven owns reference discovery and unadmitted draft editing; Floret is the sole canonical source after admission.
- Outcome: a whitespace-boundary `@` token selects one working-directory file or directory as an ordered reference chip without adding prompt text or file content.
- Invariants: discovery uses the host's authorized filesystem adapter, draft mutations use exact lease/revision CAS, and one strict `flower_composer` context action must match the frozen draft in order and directory kind.
- Failure boundary: stale search generations, draft conflicts, malformed wire data, or admission mismatches fail without preserving local authority, deleting the draft, creating a queue record, or writing canonical Floret state.

# Contract

## Composer interaction

The full composer recognizes an editable `@` token only at a whitespace boundary with a collapsed caret. IME composition and range selections suppress discovery. Selecting a candidate removes the complete token, preserves surrounding Unicode text and spacing, and adds a separate file or directory chip; the removed token is not sent as prompt text. Selecting an existing reference does not duplicate it. Chip removal restores focus predictably, and both add and remove are one exact draft lease/revision mutation. A conflict reloads the authoritative draft rather than retaining a local reference.

The combobox keeps focus in the textarea while Arrow keys move one stable active candidate, Enter or Tab selects it, and Escape dismisses the current token result. Pointer selection, retry, loading, empty, and error states use the same active identity and ARIA listbox contract. The composer announces add, duplicate, and removal outcomes through a polite live region. Reference chips remain separate from attachment previews. In the bottom command row the attachment button is fixed immediately before the More overflow control, while compact context controls retain their existing overflow behavior.

## Bounded discovery

Discovery searches the current thread's immutable working directory or the new-thread working-directory draft. `FlowerSurfaceAdapter.listWorkingDirectoryEntries` is the only search capability: Env App and Desktop implement it through their existing authenticated runtime filesystem bridges. The shared UI does not read a local path directly.

The index bounds recursion depth, listed directories, entries per directory, total candidates, path length, visible results, and cache lifetime. It skips generated and dependency directories, stays within the normalized root, and ranks exact name, name prefix, name substring, then relative-path fuzzy matches with deterministic depth/path tie breaking. Runtime/root cache identity and monotonically changing search generations prevent a late or aborted scan from replacing a newer query. Root read errors are visible and retryable; inaccessible descendants are skipped within the same bounded scan.

## Draft and admission

The draft stores ordered file/directory chips with a product-local identity, server-derived label, and opaque normalized path. Detailed persistence ownership and the v7 legacy-draft migration are defined by [Flower storage ownership and migrations](../ai/flower-storage-ownership-and-migrations.md).

Send freezes the ordered references with the text, attachments, model, and proposed TurnID. It creates one schema-v2 Ask Flower action whose source surface is `flower_composer`; each context item contains exactly `kind=file_path`, `path`, and `is_directory`. Unknown envelope, target, source, presentation, execution-context, or item fields are invalid. The action never accepts a client-authored root or display label. Prepare, direct admission, queued creation, and queued replacement carry the same normalized JSON.

The admission transaction compares the draft and context-action projections as ordered `(path, is_directory)` pairs before any draft deletion or queue mutation. Path, order, directory bit, action source, or JSON changes reject the attempt without side effects. After admission, the one-pass mapping defined by [AI tool runtime](../ai/ai-tool-runtime.md) gives Floret the canonical ordered `MessageReference` values and current-turn supplemental context.

# Boundaries

Search results and persisted paths are display and navigation metadata, not filesystem authorization. Discovery observes only what the current authorized host adapter returns under the current runtime and working directory. A reference does not read or attach file contents, grant future filesystem access, or substitute for an explicit attachment upload.

Redeven persists the ordered reference snapshot and queued action only while the turn remains unadmitted. The product-local chip identity and label are draft-editing state, not canonical identity or admission authority. Once admitted, Redeven does not retain a second queryable message-reference record, and canonical reference presentation and navigation derive from Floret reads plus current host authorization.

# Evidence

- `redeven:internal/flower_ui/src/composer/flowerComposerReferenceToken.ts` - Token parsing and replacement preserve Unicode selection boundaries and suppress reference editing during IME composition.
- `redeven:internal/flower_ui/src/composer/flowerComposerReferenceIndex.ts` - The host-backed index bounds scans, ranks deterministically, caches by runtime/root, and rejects stale generations.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:4558` - Send freezes draft references and constructs the strict `flower_composer` action before shared launch admission.
- `redeven:internal/flower_ui/src/contextActionWire.ts` - The shared parser applies strict `flower_composer` envelope and item allowlists.
- `redeven:internal/ai/context_action.go` - Runtime validation restricts composer context to normalized file-path items without client-authored labels.
- `redeven:internal/ai/threadstore/composer_drafts.go` - Draft normalization and admission compare strict ordered reference projections inside the product transaction.
- `redeven:internal/ai/threadstore/composer_reference_admission_test.go` - Tests reject shape, path, order, directory-kind, source, and JSON changes without draft or queue side effects.

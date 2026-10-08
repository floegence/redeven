---
type: UI Contract
title: Flower composer references
description: Show Ask Flower context inside the input and admit exact ordered composer references to Floret.
tags: [ui, flower, composer, references, floret]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

- Authority: Redeven owns reference discovery and unadmitted draft editing; Floret is the sole canonical source after admission.
- Outcome: Ask Flower shows its exact linked context inside the input; a whitespace-boundary `@` token adds one working-directory file or directory as an editable reference without inserting prompt text or file content.
- Invariants: discovery uses the host's authorized filesystem adapter, all visible placements in one connection share one in-memory scope, and one strict context action preserves the frozen order and directory kind.
- Failure boundary: stale search generations, malformed wire data, or admission mismatches fail without discarding the connection-local editor, creating a different queued command, or writing canonical Floret state.

# Contract

## Ask Flower context

The shared launcher and embedded Tessiven composer show linked context inside
their existing composite input boundary. A small reference chip contains only its
source icon, readable name and remove control; it has no separate heading, description, nested
card or visible version line. Complete paths and version metadata remain in the
chip's hover title. Selected file content uses the filename as its visible name.
The localized reference label remains available to assistive technology.

The launcher preserves context order and primary previews plus secondary actions,
including live-file navigation alongside a selection or attachment snapshot.
Context without a preview action uses plain text alongside its remove control.
Chips sit side by side, wrap and scroll inside a bounded input region under the
host's existing local-scroll contract. Removal updates the displayed context,
matching action item and consolidated attachment snapshots together. Removing
the last explicit action item drops the envelope rather than sending an invalid
empty context. Sending and unresolved admission disable removal so retry retains
the same intent, prompt and request identity. Removal restores focus to a nearby
remove control or the editor without discarding its draft.

Tessiven derives its chips from the live canvas request and updates object names
and hover version without replacing the canvas draft. Its empty input omits
instructional placeholder copy while retaining an accessible name. The existing
context action remains the sole submission authority. The current whole canvas
is implicit and has no visible chip. Explicit object chips are removable through
the existing canvas session owner; removing the last object restores that
implicit whole-canvas selection with the current canvas and version intact.
Context-only changes retain the request nonce and never replay its prompt or
focus request; only a new Ask Flower request claims the editor.
Editable `@` references keep their existing controls.

## Composer interaction

The full composer recognizes an editable `@` token only at a whitespace boundary with a collapsed caret. IME composition and range selections suppress discovery. Selecting a candidate removes the complete token, preserves surrounding Unicode text and spacing, and adds a separate file or directory chip; the removed token is not sent as prompt text. Selecting an existing reference does not duplicate it. Chip removal restores focus predictably, and add and remove mutate the exact connection-local composer scope synchronously. Activity, Workbench, and retained companion placements observe the same scope without an editor lease, takeover, conflict state, or persistence recovery path.

The combobox keeps focus in the textarea while Arrow keys move one stable active candidate. Enter or a pointer action on the main row adds the active file or directory as a reference. Tab completes a file token without adding it; for a directory, Tab, ArrowRight, or the row's separate localized Chevron action completes the relative token with a trailing slash and enters that directory without adding a reference. Shift+Tab retains ordinary focus navigation, and Escape dismisses the current token result. Pointer selection, retry, loading, empty, and error states use the same active identity and ARIA listbox contract. The composer announces add, duplicate, and removal outcomes through a polite live region. Reference chips remain separate from attachment previews. In the bottom command row the attachment button is fixed immediately before the More overflow control, while compact context controls retain their existing overflow behavior.

The menu is a compact opaque popover projected through the shared surface-aware floating layer. Activity companion and full-page placements expose their retained Flower product root as the floating surface host, so the menu stays in the same stacking and clipping boundary instead of falling behind the product surface. Desktop candidate rows remain 32-34 CSS pixels, directory navigation uses one persistent 28-pixel icon target, and narrow layouts may use 36-pixel rows without changing semantics. The menu measures its rendered height and stays 4-8 pixels from the composer across result and viewport changes. Its one-pixel border falls back to the shared theme border when a Flower-local token is absent. Composer focus preserves the same one-pixel geometry and shadow, changing only to a restrained border color; candidate and directory-action focus-visible states remain explicit.

## Bounded discovery

Discovery searches the current thread's immutable working directory or the new-thread working-directory draft. `FlowerSurfaceAdapter.listWorkingDirectoryEntries` is the only search capability: Env App and Desktop implement it through their existing authenticated runtime filesystem bridges. The shared UI does not read a local path directly.

The index bounds recursion depth, listed directories, entries per directory, total candidates, path length, visible results, and cache lifetime. It skips generated and dependency directories, stays within the normalized root, and ranks exact name, name prefix, name substring, then relative-path fuzzy matches with deterministic depth/path tie breaking. A token without a slash uses that bounded global matching behavior. A token with a slash treats the normalized prefix as a browsing scope and returns only that directory's direct children, filtered by the suffix after the final slash; nested descendants and global matches do not leak into the scoped list. Runtime/root cache identity and monotonically changing search generations prevent a late or aborted scan from replacing a newer query. Root read errors are visible and retryable; inaccessible descendants are skipped within the same bounded scan.

## Draft and admission

The connection-local composer stores ordered file/directory chips with a product-local identity, host-derived label, and opaque normalized path. It is never written to Redeven, Floret, local storage, IndexedDB, or another connection. The first-release product v1 baseline has no server draft, draft migration, or compatibility reader; [Flower storage ownership and migrations](../ai/flower-storage-ownership-and-migrations.md) defines that boundary.

Send freezes the ordered references with the text, attachments, model, and stable product request identity. It creates one strict Ask Flower action whose source surface is `flower_composer` for the ordinary chat. An embedded Tessiven conversation preserves its exact `tessiven` selection envelope and appends the frozen file references to that same action; each file context item contains exactly `kind=file_path`, `path`, and `is_directory`. Unknown envelope, target, source, presentation, execution-context, or item fields are invalid. The action never accepts a client-authored root, display label, TurnID, or RunID. The typed Send mapping converts that one frozen action into canonical Floret references whether the runtime accepts an immediate turn or canonical queue input.

The browser transport outbox may retain the original ordinary launch input under its exact `client_request_id` until canonical confirmation. Retry uses that same transport identity; it does not create a Redeven backend command row or use Floret's queue item ID as an idempotency key. After admission, the one-pass mapping defined by [AI tool runtime](../ai/ai-tool-runtime.md) gives Floret the canonical ordered `MessageReference` values and current-turn supplemental context.

# Boundaries

Search results and persisted paths are display and navigation metadata, not filesystem authorization. Discovery observes only what the current authorized host adapter returns under the current runtime and working directory. A reference does not read or attach file contents, grant future filesystem access, or substitute for an explicit attachment upload.

Before Send, Redeven does not persist the ordered editable reference snapshot. After Send, only the browser transport outbox may retain the original ordinary launch payload until canonical confirmation or terminal cleanup; the product-local chip identity and label are not canonical identity or admission authority. Once admitted, Redeven does not retain a second queryable message-reference record, and canonical reference presentation and navigation derive from Floret reads plus current host authorization.

# Evidence

- `redeven:internal/flower_ui/src/composer/FlowerComposerContextReferences.tsx` - Compact removable chips reuse the input boundary and restore keyboard focus.
- `redeven:internal/flower_ui/src/composer/removeFlowerTurnLauncherReference.ts` - Removal keeps display, action and consolidated attachment identities aligned.
- `redeven:internal/flower_ui/src/FlowerTurnLauncherPanel.test.tsx` - Exact removal and submission, frozen retry context, selection previews and consolidated snapshots.
- `redeven:internal/envapp/ui_src/src/styles/flower-composer-context.browser.test.tsx` - Real Chromium checks bounded scrolling, narrow layouts, all built-in themes and unchanged focus geometry.
- `redeven:internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx` - Hidden default scope, compact parallel object chips, removal, draft isolation and exact context alongside native file references.
- `redeven:internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx` - The page session owner removes the selected object and preserves implicit canvas scope.
- `redeven:internal/flower_ui/src/composer/flowerComposerReferenceToken.ts` - Token parsing and replacement preserve Unicode selection boundaries and suppress reference editing during IME composition.
- `redeven:internal/flower_ui/src/composer/flowerComposerReferenceIndex.ts` - The host-backed index bounds scans, ranks deterministically, caches by runtime/root, and rejects stale generations.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - One shell-owned in-memory scope shares text and reference chips without persistence or editor ownership.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Send freezes connection-local references and constructs the strict `flower_composer` action before shared launch admission.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerReferences.browser.test.tsx` - Chromium verifies compact density, measured placement, focus geometry, projected companion containment, and directory action sizing.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Chromium verifies the retained Activity Flower product root remains the floating surface host across companion and full-page placement.
- `redeven:internal/flower_ui/src/contextActionWire.ts` - The shared parser applies strict `flower_composer` envelope and item allowlists.
- `redeven:internal/ai/context_action.go` - Runtime validation restricts composer context to normalized file-path items without client-authored labels.
- `redeven:internal/flower_ui/src/contextActionWire.test.ts` - Browser contract tests reject unknown envelope and item fields and preserve file/directory kind.
- `redeven:internal/ai/context_action_floret_test.go:258` - Host tests map exact context items into typed Floret references.
- `redeven:internal/ai/context_action_floret_test.go:361` - Canonical turn input retains references without persisting the host action envelope.

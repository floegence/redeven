---
type: UI Contract
title: Flower input history
description: Recall canonical user text into an empty Flower draft with terminal-style arrow keys while preserving ordinary editor ownership.
tags: [ui, flower, composer, keyboard, drafts]
timestamp: 2026-09-21T00:00:00Z
---
# Summary

- Authority: Floret supplies canonical messages through the existing thread cache; the published Floe input-history controller owns transient keyboard navigation, and Redeven owns candidate selection and the shared draft.
- Outcome: ArrowUp in an empty ordinary Flower editor recalls the latest user text for editing or explicit resubmission.
- Invariants: recall never submits, mutates canonical messages, restores attachments, or overwrites a nonempty draft. Input-method composition, selections, menus and structured answers retain keyboard ownership.
- Recovery boundary: leaving the editor or changing its scope, availability, candidates or externally authored draft ends browsing without discarding the current text.

# Contract

## Candidates and ownership

Only canonical ordinary user messages in the selected thread are eligible.
Preserve message order, exact text, newlines and separate identities for repeated
text. Exclude assistant/system messages, synthetic rows, unsent queue entries,
restored-input notices, empty messages and structured input-response receipts,
including redacted secret answers. A failed or canceled turn does not erase its
already admitted user input.

Candidates derive from `ThreadCache` details, never summaries, DOM text or a new
backend query. The editor delegates generic navigation to the released
`@floegence/floe-webapp-core/chat` controller. It freezes candidates for one
browsing session; later additions become available on the next session. Changed
or removed candidates end that session. No history database, browser storage,
transport reconnect or replay is introduced.

Recalled text is committed through the existing connection-local composer draft
coordinator. Other placements observe that same text. Attachments, references,
working directory and model choices stay unchanged. A draft revision from
another writer ends local navigation even when the text is identical. Draft
ownership remains defined by [Flower composer references](flower-composer-references.md).

## Keyboard interaction

An exactly empty ordinary chat textarea accepts unmodified ArrowUp to recall the
newest eligible input. ArrowDown from empty does nothing. While browsing,
ArrowUp selects older inputs and stops at the oldest; ArrowDown selects newer
inputs and restores empty after the newest. Escape restores empty and ends
browsing before an enclosing companion handles dismissal. Recall leaves focus
in the editor with a collapsed caret at the end and uses existing autosizing.
Multiline inputs remain browsable until ordinary editing begins.

Typing, deletion, paste, caret movement, pointer positioning, composition start,
blur, hiding and submission end browsing. These actions retain the current text
and their normal behavior. A nonempty draft, including whitespace, never starts
history browsing. Enter still submits explicitly and Shift+Enter inserts a
newline. Existing completion menus have priority. Recall alone does not open
reference or slash-command completion; subsequent editing restores completion.

Read-only or unavailable editors and structured question/password inputs cannot
browse history. Input-method composition, key-code 229, range selections and
modifier combinations are not intercepted. Changing threads resets navigation
while each thread's ordinary draft remains in its existing scope.

## Presentation

When eligible history exists, append a localized arrow-key hint to the empty
ordinary editor's placeholder. A polite live region announces position from
newest and return to empty. Do not add a popup, focus transfer, focus border
override or additional visible history controls. The same shared behavior
applies to Desktop, Env App, Activity, Workbench and companion placements.

# Boundaries

Recall never submits, changes canonical messages, restores attachments or overwrites a nonempty draft. Composition and other keyboard owners take precedence. Scope, availability, candidate or external-draft changes end browsing while preserving current text.

# Evidence

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.ts` - Selects canonical ordinary user text without restoring metadata or structured answers.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Integrates released navigation with draft revisions, keyboard ownership, completion, visibility and localized announcements.
- `redeven:internal/flower_ui/src/composer/flowerInputHistory.test.ts` - Verifies candidate authority, repeated text and secret-answer exclusion.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.inputHistory.test.tsx` - Checks recall, shared-draft protection and keyboard exclusions.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.inputHistory.browser.test.tsx` - Verifies native keyboard behavior, caret and autosizing across surface placements.
- `redeven:desktop/scripts/check-flower-navigation.mjs` - Verifies canonical user recall in the Desktop host and retained draft navigation.

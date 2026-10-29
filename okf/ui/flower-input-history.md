---
type: UI Contract
title: Flower input history
tags: [ui, flower, composer, keyboard, drafts]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floret/cache supplies canonical user text; published Floe owns transient history navigation and Redeven owns shared drafts/candidates. Unmodified ArrowUp in an exactly empty ordinary editor recalls text for editing, never submits. IME, selection, menus and structured answers retain keys. Scope or external-draft changes stop browsing without discarding text.

# Contract

## Candidates and ownership
Only selected-thread canonical ordinary user messages qualify, never metadata, secrets or structured answers. [Composer references](flower-composer-references.md) owns draft scope.

## Keyboard interaction
Unmodified ArrowUp in an exactly empty textarea recalls newest eligible text. Whitespace counts as a nonempty draft. Thread changes reset history browsing while retaining each draft.

## Presentation
All placements use localized Ask Flower... without history instructions in the placeholder. Recall restores no attachments or canonical mutations.

# Boundaries

Recall never submits, changes canonical messages, restores attachments or overwrites a nonempty draft. Scope, availability, candidate or external-draft changes end browsing while preserving current text.

# Evidence

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.ts` - Selects canonical ordinary user text without restoring metadata or structured answers.

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.test.ts` - Verifies candidate authority, repeated text and secret-answer exclusion.

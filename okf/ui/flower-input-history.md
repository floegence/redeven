---
type: UI Contract
title: Flower input history
tags: [ui, flower, composer, keyboard, drafts]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Canonical Floret/cache text feeds Floe transient navigation and shared drafts. Unmodified ArrowUp in exactly empty chat recalls editable text, never submits. IME/selection/menus/structured answers keep keys; scope or external-draft changes stop browsing without losing text.

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

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.ts` - Source.
- `redeven:internal/flower_ui/src/composer/flowerInputHistory.test.ts` - Tests.

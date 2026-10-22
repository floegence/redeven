---
type: UI Contract
title: Flower input history
description: Recall canonical user text into an empty Flower draft with terminal-style arrow keys while preserving ordinary editor ownership.
tags: [ui, flower, composer, keyboard, drafts]
timestamp: 2026-09-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret supplies canonical messages through the existing thread cache; the published Floe input-history controller owns transient keyboard navigation, and Redeven owns candidate selection and the shared draft.
- Outcome: ArrowUp in an empty ordinary Flower editor recalls the latest user text for editing or explicit resubmission.
- Invariants: recall never submits, mutates canonical messages, restores attachments, or overwrites a nonempty draft. Input-method composition, selections, menus and structured answers retain keyboard ownership.
- Recovery boundary: leaving the editor or changing its scope, availability, candidates or externally authored draft ends browsing without discarding the current text.

# Contract

## Candidates and ownership
Only canonical ordinary user messages in the selected thread are eligible.

Draft ownership remains defined by [Flower composer references](flower-composer-references.md).

## Keyboard interaction
An exactly empty ordinary chat textarea accepts unmodified ArrowUp to recall the newest eligible input.

A nonempty draft, including whitespace, never starts history browsing.

Changing threads resets navigation while each thread's ordinary draft remains in its existing scope.

## Presentation
The ordinary editor uses the concise localized "Ask Flower..." placeholder regardless of available history, without keyboard instructions. The same shared behavior applies to Desktop, Env App, Activity, Workbench and companion placements.

# Boundaries

Recall never submits, changes canonical messages, restores attachments or overwrites a nonempty draft. Scope, availability, candidate or external-draft changes end browsing while preserving current text.

# Evidence

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.ts` - Selects canonical ordinary user text without restoring metadata or structured answers.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Integrates released navigation with draft revisions, keyboard ownership, completion, visibility and localized announcements.

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.test.ts` - Verifies candidate authority, repeated text and secret-answer exclusion.

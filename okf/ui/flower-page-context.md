---
type: UI Contract
title: Flower Activity origin page references
tags: [ui, flower, activity, references, draft]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

New desktop companion captures removable origin context without reads/editor replacement; existing threads do not. New chat/open with no selection refreshes; later edits/navigation do not. Submission uses exact visible text; terminal captures current screen, excluding unauthorized/unloaded facts.

# Contract

The desktop Activity companion in Desktop and browser Env App captures the origin page immediately on every explicit New conversation action and every explicit companion opening without a selected thread, including reversal during close. Switching pages and selecting or reopening an existing thread never add context.

The automatic reference alone cannot enable empty Send.

# Boundaries

[Flower composer references](flower-composer-references.md) owns draft freezing, strict text/file action shapes and canonical Floret admission. The [Activity companion](flower-activity-companion.md) owns placement, dismissal and one retained Flower product; page capture adds no lifecycle or stream.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/flower/flowerPageContext.ts` - Source.

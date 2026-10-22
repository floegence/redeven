---
type: UI Contract
title: Flower Activity origin page references
description: Freeze only the visible Activity page facts for a new companion conversation.
tags: [ui, flower, activity, references, draft]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns Activity page readers and unadmitted page references. A new desktop
companion conversation captures one removable origin snapshot without requesting
data or replacing its native editor. Existing conversations never receive it.
Each explicit opening without a selected thread or New action refreshes it;
navigation and editing within that opening do not. Submission and
same-request retry use its exact visible text; the existing draft and transport
owners retain failed intent. Terminal references include the currently displayed
screen through the same local capture path as right-click Ask Flower. Unloaded or
unauthorized page facts are omitted.

# Contract

The desktop Activity companion in Desktop and browser Env App captures the origin page immediately on every explicit New conversation action and every explicit companion opening without a selected thread, including reversal during close. Switching pages and selecting or reopening an existing thread never add context.

The automatic reference alone cannot enable empty Send.

# Boundaries

[Flower composer references](flower-composer-references.md) owns draft freezing, strict text/file action shapes and canonical Floret admission. The [Activity companion](flower-activity-companion.md) owns placement, dismissal and one retained Flower product; page capture adds no lifecycle or stream.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - One host presentation for launcher and composer/chat snapshots.

- `redeven:internal/flower_ui/src/icons/FlowerContextIcon.tsx` - Shared reference identity includes a dedicated page-context glyph.

- `redeven:internal/envapp/ui_src/src/ui/flower/flowerPageContext.ts` - Reader functions and bounded immutable page snapshots.

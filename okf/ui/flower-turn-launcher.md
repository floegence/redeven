---
type: UI Contract
title: Flower command and composer flow
description: Immediate typed commands, durable transport outbox, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Flower sends ordinary input through a stable request ID and receives a typed current view immediately. The composer, thread rail, Stop, interaction controls, and thread switching remain usable while provider work continues. A short-lived IndexedDB outbox retains only ordinary launch input until the canonical view confirms its request ID; secret interaction answers never enter it.

# Contract

`ComposerDraftStore` owns text, references, attachments, per-question input drafts, model/reasoning choices, and upload staging for each thread. Switching A-to-B-to-A changes selection immediately and restores each draft without transferring execution ownership. Sending captures immutable input, writes the transport outbox, clears only the accepted draft content, and invokes typed Send. If the thread is busy, Floret places the input directly in its canonical queue; Flower does not move a locally rendered message between transcript and queue.

`TransportOutbox` is transport recovery only. It stores request ID and original non-secret launch input, retries the same request identity after reconnect, and deletes the entry when a typed view contains the matching canonical user item or queue request. It has no turn, approval, receipt, operation, or lifecycle state.

Respond, Approve, Reject, Stop, Retry, and RetryEffect are ordinary idempotent commands. Their progress never applies `inert`, a pointer overlay, or a shared busy state to the rail, surface, or composer. Approval and waiting-user controls coexist with navigation and editable draft state. RetryEffect stays on the exact unknown tool row and requires explicit acknowledgement; it does not resend the user turn.

# Evidence

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread composer draft owner.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Immediate selection, queue rendering, interaction commands, and unlocked navigation.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Typed HTTP command mapping.

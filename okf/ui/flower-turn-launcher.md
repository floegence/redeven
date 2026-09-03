---
type: UI Contract
title: Flower command and composer flow
description: Accepted typed commands, canonical detail recovery, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-09-03T00:00:00Z
---
# Summary

Flower sends ordinary input through a stable request ID. A successful command receipt confirms the request and Thread identities; a valid typed current view may arrive in that response or through canonical detail and live transport. The composer, thread rail, Stop, interaction controls, and thread switching remain usable while provider work continues. A short-lived IndexedDB outbox retains only ordinary launch input until the canonical view confirms its request ID; secret interaction answers never enter it.

# Contract

`ComposerDraftStore` owns text, references, attachments, per-question input drafts, model/reasoning choices, and upload staging for each thread. Switching A-to-B-to-A changes selection immediately and restores each draft without transferring execution ownership. Sending captures immutable input and completes the transport-outbox write before invoking typed Send, then clears only the content covered by an accepted receipt. A persistence failure is visible and prevents network admission, so an unknown result cannot lose its stable recovery identity on reload. If the thread is busy, Floret places the input directly in its canonical queue; Flower does not move a locally rendered message between transcript and queue.

`TransportOutbox` is transport recovery only. It stores request ID and original non-secret launch input and retries the same identity only while the transport outcome is unknown. An accepted receipt binds the entry to the authoritative ThreadID, settles the submitted draft, and transfers the still-current New Chat selection. The entry remains as the optimistic row until a validated typed view contains the matching canonical user item or queue request. If the receipt has no valid current view, Flower loads canonical detail for the selected thread; it does not turn a delayed projection into a send failure. A later user navigation fences only the selection transfer. An entry already addressed to another real thread cannot be rebound or cleared. Entries expire under a bounded TTL during long-lived sessions as well as restore, terminal attachment capability loss settles instead of retrying forever after restart, deleting a thread clears its remaining entries, and surface teardown stops cleanup timers. IndexedDB read and write errors are propagated rather than swallowed. It has no turn, approval, operation, or lifecycle state.

Respond, Approve, Reject, Stop, and Retry are ordinary idempotent commands. Reject All submits one Floret Answers batch so the visible approval set cannot partially settle. Their progress never applies `inert`, a pointer overlay, or a shared busy state to the rail, surface, or composer. Approval and waiting-user controls coexist with navigation and editable draft state. An unknown effect outcome is terminal: Flower shows the safe failure explanation, offers no replay control, and keeps the composer available for a new reply.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input and stable request identity. They never become canonical queue, interaction, effect, turn, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

# Evidence

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread composer draft owner.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.
- `redeven:internal/flower_ui/src/transportOutbox.test.ts` - TTL, terminal attachment, reload, and thread-delete cleanup coverage.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Immediate selection, queue rendering, interaction commands, and unlocked navigation.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Typed HTTP command mapping.

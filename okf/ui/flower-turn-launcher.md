---
type: UI Contract
title: Flower command and composer flow
description: Accepted typed commands, canonical detail recovery, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-09-05T00:00:00Z
---
# Summary

Flower assigns one request ID to an input intent and reuses it for retries. New-thread HTTP puts it in `create.client_request_id`; existing-thread HTTP uses top-level `client_request_id`, with ThreadID owned by the URL. The core rejects missing, duplicate, invalid, or conflicting identities, while the legacy RPC adapter may fill only a missing ID. Accepted receipts echo the exact request and Thread IDs. Composer, rail, Stop, interactions, and switching remain usable during provider work. A short-lived outbox retains non-secret input and provisional new-thread settings until canonical confirmation; secret answers never enter it.

# Contract

`ComposerDraftStore` owns text, references, attachments, per-question input drafts, model/reasoning choices, and upload staging for each thread. Switching A-to-B-to-A changes selection immediately and restores each draft without transferring execution ownership. Sending captures immutable input and completes the transport-outbox write before invoking typed Send, then clears only the content covered by an accepted receipt. A persistence failure is visible and prevents network admission, so an unknown result cannot lose its stable recovery identity on reload. If the thread is busy, Floret places the input directly in its canonical queue; Flower does not move a locally rendered message between transcript and queue.

`TransportOutbox` is transport recovery only. It stores request ID, original non-secret launch input, and the effective permission, model, reasoning, and working directory captured for a new Thread. Those settings initialize only a provisional UI snapshot; canonical product metadata replaces them by `settings_revision`, and they never authorize execution. The outbox retries the same identity only while the transport outcome is unknown. An accepted receipt with exact request and Thread identities binds the entry to the authoritative ThreadID, settles the submitted draft, and transfers the still-current New Chat selection. Missing or conflicting receipt identities fail explicitly and cannot settle another request. The entry remains as the optimistic row until a validated typed view contains the matching canonical user item or queue request. If the receipt has no valid current view, Flower loads canonical detail for the selected thread; it does not turn a delayed projection into a send failure. A later user navigation fences only the selection transfer. An entry already addressed to another real thread cannot be rebound or cleared. Entries expire under a bounded TTL during long-lived sessions as well as restore, terminal attachment capability loss settles instead of retrying forever after restart, deleting a thread clears its remaining entries, and surface teardown stops cleanup timers. IndexedDB read and write errors are propagated rather than swallowed. It has no turn, approval, operation, or lifecycle state.

Turn admission has one result model. `not_sent` means local validation stopped before network admission. `accepted` means the exact request and Thread receipt was returned. `rejected` means the server explicitly refused the command. `unknown` means no usable response arrived, including timeout, disconnect, malformed success JSON, or a missing or conflicting success receipt. `accepted` settles the submitted draft and outbox without a success toast. `not_sent` and `rejected` restore editable input and use the launcher inline red error as the only presentation. `unknown` preserves the exact identity and frozen payload, never claims the send failed, and retries or reconciles only that request. Adapters serialize and classify transport results; they do not own toast, draft restoration, or a second admission state.

Respond, Approve, Reject, Stop, and Retry are ordinary idempotent commands. Reject All submits one Floret Answers batch so the visible approval set cannot partially settle. Their progress never applies `inert`, a pointer overlay, or a shared busy state to the rail, surface, or composer. Approval and waiting-user controls coexist with navigation and editable draft state. An unknown effect outcome is terminal: Flower shows the safe failure explanation, offers no replay control, and keeps the composer available for a new reply.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input, stable request identity, and presentation-only launch settings. They never become authorization evidence or canonical queue, interaction, effect, turn, Thread settings, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

# Evidence

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread composer draft owner.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.
- `redeven:internal/flower_ui/src/transportOutbox.test.ts` - TTL, terminal attachment, reload, and thread-delete cleanup coverage.
- `redeven:internal/flower_ui/src/flowerTurnAdmission.ts` - Canonical HTTP body, exact receipt validation, and admission failure classification.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Immediate selection, queue rendering, interaction commands, and unlocked navigation.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Typed HTTP command mapping.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx` - Desktop HTTP mapping for stable new-thread and existing-thread request identities.

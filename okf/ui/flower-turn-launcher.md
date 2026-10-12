---
type: UI Contract
title: Flower command and composer flow
description: Immediate delivery feedback, ordered transport recovery, canonical confirmation, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-10-11T00:00:00Z
---
# Summary

Flower assigns one request ID to an input intent and reuses it for retries. New-thread HTTP puts it in `create.client_request_id`; existing-thread HTTP uses top-level `client_request_id`, with ThreadID owned by the URL. The core rejects missing, duplicate, invalid, or conflicting identities, while the legacy RPC adapter may fill only a missing ID. Accepted receipts echo the exact request and Thread IDs. Composer, rail, Stop, interactions, and switching remain usable during provider work. A short-lived outbox retains non-secret input and provisional new-thread settings until canonical confirmation; secret answers never enter it.

# Contract

`ComposerDraftStore` owns text, references, attachments, per-question input drafts, model/reasoning choices, and upload staging for each thread. Switching A-to-B-to-A changes selection immediately and restores each draft without transferring execution ownership. Preparation freezes the submitted input while keeping the draft visible and showing a busy state. A synchronous preparation guard prevents the same draft from being captured twice; it does not cover IndexedDB or HTTP. Once the existing `TransportOutbox` owns the complete immutable request, Flower clears only its frozen text, references, and attachments. Changes made during preparation remain in the composer. Subsequent submissions enter the same outbox without waiting for the first HTTP response.

Text ownership uses an independent text revision, so editing away and back to the submitted text creates a new draft even when its final string matches. Reference and upload changes do not invalidate unchanged text. The existing admission handoff shares one provisional-scope binding with preparations already underway; acceptance moves their draft and preparation guard to the canonical thread, and their final outbox input uses that same thread identity.

The queue dock renders the transport request immediately, with Sending or Waiting to send feedback. Canonical queue `request_key` reuses that row identity, so confirmation replaces the row in place without a duplicate transcript item. A single dispatcher sends requests in submission order per thread and waits for request-level IndexedDB persistence before network admission. IndexedDB updates put or delete only changed requests. A local persistence failure produces a definite failed row and permits explicit retry with the original identity. Other threads, navigation, input, Stop, and interactions remain available.

`TransportOutbox` is transport recovery only. It stores request ID, original non-secret launch input, unadmitted composer references for explicit recovery, and the effective permission, model, reasoning, and working directory captured for a new Thread. Those settings initialize only a provisional UI snapshot; canonical product metadata replaces them by `settings_revision`, and they never authorize execution. Accepted HTTP receipts and canonical current confirmations share one success handoff. It binds provisional requests to the authoritative ThreadID, notifies the frozen embedded owner once, and transfers only the still-current New Chat selection. Later requests captured for that provisional conversation inherit the accepted ThreadID. A later user navigation fences only selection transfer. An entry addressed to another real thread cannot be rebound or cleared.

An accepted receipt releases the next same-thread request but retains the delivery row until a validated typed view confirms its canonical user item or queue request. Canonical confirmation can release the next request before a slow HTTP response arrives; a later transport error cannot overwrite that success. Missing or conflicting receipt identities produce an unknown result. If an accepted receipt lacks valid current, Flower loads the selected thread's canonical detail; delayed projection is not a failed send. Entries use a bounded TTL, thread deletion clears remaining entries, and surface teardown stops cleanup timers. IndexedDB errors remain visible. The outbox records request delivery, never an admitted turn, approval, effect, or Agent lifecycle.

Turn admission has one result model. `not_sent` means local preparation or persistence stopped before network admission. `accepted` means an exact receipt or canonical confirmation established admission. `rejected` means the server explicitly refused the command. `unknown` means no usable response arrived, including timeout, disconnect, malformed success JSON, or a missing or conflicting success receipt. Accepted input uses no success toast. Definite failures remain in the dock with Retry, Copy, Restore to empty editor, and Delete unsent message; restoration never overwrites a newer draft. In-memory attachment files and frozen references restore together through the draft owner. Unknown input retains its original identity and payload, pauses later requests only for that thread, and offers same-ID Retry, Refresh confirmation, and Copy. It cannot be deleted as an unsent request or restored as a new submission. Later requests that have not been dispatched remain removable or restorable. Reload never automatically replays a request whose transport outcome may be unknown. Adapters serialize and classify responses; the shared surface owns presentation and recovery.

Product request IDs pass Floret's public `identity.ParseLogicalRequestID` before
admission. Invalid IDs fail without a canonical message or queued input; the
host does not admit a command that will fail later at provider storage.

Attachment capability loss after restart produces a local recovery copy rather than an endless retry. It visibly explains that files must be selected again and offers canonical refresh, Copy, and restoration of text and references into an empty draft. Restoration does not send automatically and retains an unknown original request for refresh, keeping later messages paused. Its removal is explicitly labeled Remove local recovery copy and explains that later messages resume while the original server request is not cancelled. Canonical confirmation still consumes the retained original identity. Acceptance, thread deletion, expiry, explicit removal, and surface disposal release the request's short-lived callbacks, adapter, local files, and preparation flags.

Context-compaction delivery uses the same dock and dispatcher with an explicit Compact context label. An unknown compaction pauses later input and exposes same-ID Retry and canonical Refresh; it cannot require retyping a slash command to recover. A confirmed compaction response removes its transport row and releases later requests. The UI never infers a request identity from a turn or run identity.

Respond, Approve, Reject, Stop, and Retry are ordinary idempotent commands. Reject All submits one Floret Answers batch so the visible approval set cannot partially settle. Their progress never applies `inert`, a pointer overlay, or a shared busy state to the rail, surface, or composer. Approval and waiting-user controls coexist with navigation and editable draft state. An unknown effect outcome is terminal: Flower shows the safe failure explanation, offers no replay control, and keeps the composer available for a new reply.

## Restored data and preserved inputs

An explicit new submission fetches the current storage generation before
persisting its immutable outbox input. Env App and Desktop use the same public
endpoint; retries keep the original generation. A restore changes that value,
and `AI_STORAGE_RESTORED` rejects the old request before admission. The outbox
keeps rejected text copyable and explicitly restorable and never silently
resubmits it. Both clients share the current Runtime/Desktop compatibility contract.

Floret restored queue inputs appear in a separate readonly section with text,
attachment names, references and Copy. They have no promote, retry or run
identity synthesized by the UI. Re-running preserved input requires an explicit
new submission; old approvals and uncertain tool effects cannot resume.

## Context preview presentation

Env App renders launcher references and composer/chat snapshots through one
`FlowerContextPreviewWindow`, using the existing `PreviewWindow` and
`FilePreviewContent`. It retains shared geometry persistence, safe-area limits,
drag/resize, localized footer controls and text/media viewers. Launcher owns
attachment IO, request sequencing and object-URL disposal; Flower owns draft or
canonical snapshot validity. Extracting the presentation creates no additional
reader, draft or lifecycle authority. Related-surface markers keep preview input
owned by Flower, and Escape dismisses the preview before its companion.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input, stable request identity, and presentation-only launch settings. They never become authorization evidence or canonical queue, interaction, effect, turn, Thread settings, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Shared host presentation; immutable snapshots use the existing text viewer.

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread composer draft owner.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.
- `redeven:internal/flower_ui/src/transportOutbox.test.ts` - TTL, terminal attachment, reload, and thread-delete cleanup coverage.
- `redeven:internal/flower_ui/src/flowerTurnAdmission.ts` - Canonical HTTP body, exact receipt validation, and admission failure classification.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Immediate selection, queue rendering, interaction commands, and unlocked navigation.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Typed HTTP command mapping.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.transportDelivery.browser.test.tsx` - Immediate feedback, ordered sends, exact confirmation, thread isolation, and explicit recovery.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx` - Desktop HTTP mapping for stable new-thread and existing-thread request identities.

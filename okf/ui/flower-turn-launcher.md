---
type: UI Contract
title: Flower command and composer flow
description: Immediate delivery feedback, ordered transport recovery, canonical confirmation, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Each input intent has one request ID reused for retries; accepted receipts echo exact request/Thread IDs. New-thread HTTP nests it under create, existing-thread HTTP uses top-level client_request_id with URL-owned ThreadID. The short-lived outbox retains non-secret unconfirmed input/settings; composer, Stop, navigation and interactions remain usable during work.

# Contract

Core commands reject missing, duplicate, invalid or conflicting IDs; only the legacy RPC adapter may fill a missing one. [Goals](../ai/flower-goals.md) share the outbox. Empty-thread creation retains text/reference/attachment authority; first Send binds staged resources to the authorized canonical thread. Unknown effect outcomes are terminal with safe explanation and no replay action.

## Immediate send feedback
The immutable transport outbox owns submitted text, references and attachment
metadata before IndexedDB or HTTP completes. Ordinary sends render a pending
user row immediately and consume only the captured draft; newer edits stay in
the composer. Request-key message and section identities survive canonical
admission, including receipt/live ordering and prepended history. Images reserve
the same thumbnail geometry and use the authorized staged preview until admitted.
Failed and unknown outcomes retain the frozen request for explicit recovery;
server 5xx responses never prove rejection or authorize a fresh request identity.

Product admission uses published SendAck and narrow canonical summaries. HTTP
and RPC return admission identity without a post-commit history read; authorized
window observation supplies presentation separately. Agent preparation binds the
already persisted execution authority to the admitted turn. No duplicate
post-admission authority write or second conversation lifecycle is introduced.
Full model history remains an engine execution requirement, not a prerequisite
for painting the submitted message.

## Restored data and preserved inputs
New submissions capture storage generation immediately, even behind paused dispatch. Rejected input stays copyable/restorable; running it requires explicit new submission, never resumed old approvals/effects.

## Context preview presentation
One Env App `FlowerContextPreviewWindow` uses existing preview/text components for launcher and draft/canonical snapshots. Launcher owns attachment IO, sequencing and URL cleanup; Flower owns validity. Related-surface markers preserve input ownership; Escape dismisses preview before companion.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input, stable request identity, and presentation-only launch settings. They never become authorization evidence or canonical queue, interaction, effect, turn, Thread settings, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Shared host presentation; immutable snapshots use the existing text viewer.

- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.

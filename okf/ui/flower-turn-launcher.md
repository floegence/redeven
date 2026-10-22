---
type: UI Contract
title: Flower command and composer flow
description: Immediate delivery feedback, ordered transport recovery, canonical confirmation, and always-available navigation.
tags: [ui, flower, composer, commands]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower assigns one request ID to an input intent and reuses it for retries. New-thread HTTP puts it in `create.client_request_id`; existing-thread HTTP uses top-level `client_request_id`, with ThreadID owned by the URL. The core rejects missing, duplicate, invalid, or conflicting identities, while the legacy RPC adapter may fill only a missing ID. Accepted receipts echo the exact request and Thread IDs. Composer, rail, Stop, interactions, and switching remain usable during provider work. A short-lived outbox retains non-secret input and provisional new-thread settings until canonical confirmation; secret answers never enter it.

# Contract

[Goal commands](../ai/flower-goals.md) mutate controls through the same outbox. Empty-thread creation retains text, references and attachment authority; the first Send binds draft staging to the authorized canonical thread.

An unknown effect outcome is terminal: Flower shows the safe failure explanation, offers no replay control, and keeps the composer available for a new reply.

## Restored data and preserved inputs
An explicit new submission captures the storage generation lookup immediately, even while a predecessor pauses dispatch. The outbox keeps rejected text copyable and explicitly restorable and never silently resubmits it.

Re-running preserved input requires an explicit new submission; old approvals and uncertain tool effects cannot resume.

## Context preview presentation
Env App renders launcher references and composer/chat snapshots through one `FlowerContextPreviewWindow`, using the existing `PreviewWindow` and `FilePreviewContent`. Launcher owns attachment IO, request sequencing and object-URL disposal; Flower owns draft or canonical snapshot validity. Related-surface markers keep preview input owned by Flower, and Escape dismisses the preview before its companion.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input, stable request identity, and presentation-only launch settings. They never become authorization evidence or canonical queue, interaction, effect, turn, Thread settings, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Shared host presentation; immutable snapshots use the existing text viewer.

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread composer draft owner.

- `redeven:internal/flower_ui/src/transportOutbox.ts` - IndexedDB request recovery without secret answers.

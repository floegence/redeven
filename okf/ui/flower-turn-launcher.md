---
type: UI Contract
title: Flower turn submission, outbox and input recall
tags: [ui, flower, composer, commands]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

One immutable transport outbox captures ordinary submitted text and resources before asynchronous admission. Product admission uses published SendAck and narrow canonical summaries. HTTP and RPC return admission identity without a post-commit history read; authorized window observation supplies presentation separately.

# Contract

## Submission
Core commands reject missing, duplicate, invalid or conflicting IDs; only the legacy RPC adapter may fill a missing one. [Goals](../ai/flower-goals.md) share the outbox. Empty-thread creation retains text/reference/attachment authority; first Send binds staged resources to the authorized canonical thread. Unknown effect outcomes are terminal with safe explanation and no replay action.

### Immediate send feedback
The immutable transport outbox owns submitted text, references and attachment
metadata before IndexedDB or HTTP completes. Ordinary sends render a pending
user row immediately and consume only the captured draft; newer edits stay in
the composer. Request-key message and section identities survive canonical
admission, including receipt/live ordering and prepended history. Images reserve
the same thumbnail geometry and use the authorized staged preview until admitted.
Failed and unknown outcomes retain the frozen request for explicit recovery;
server 5xx responses never prove rejection or authorize a fresh request identity.

Composer-origin failures remain under their original transcript row with a
visible explanation and persistent recovery actions; they are not duplicated in
the queue dock. Queue-origin failures keep their existing dock placement.
Workspace-unavailable codes receive localized copy without internal paths.
Retry retains the request identity; copy, restore and removal never auto-submit.

Agent preparation binds the
already persisted execution authority to the admitted turn. No duplicate
post-admission authority write or second conversation lifecycle is introduced. Full model history remains an engine execution requirement, not a prerequisite
for painting the submitted message.

### Restored data and preserved inputs
New submissions capture storage generation immediately, even behind paused dispatch. Rejected input stays copyable/restorable; running it requires explicit new submission, never resumed old approvals/effects.

### Context preview presentation
A new contextual invocation restores editor focus even when the card is already open, preserving its draft and insertion point while raising it above the reactivated source window. Mobile file dialogs use the product-modal band; Ask Flower and its reference inspector use successive higher bands below the command menu. Do not fix ordinary desktop activation by giving all cards a permanently higher layer.

One Env App `FlowerContextPreviewWindow` uses existing preview/text components for launcher and draft/canonical snapshots. Launcher owns attachment IO, sequencing and URL cleanup; Flower owns validity. Related-surface markers preserve input ownership; Escape dismisses preview before companion.

## Input recall
### Candidates and ownership
Only selected-thread canonical ordinary user messages qualify, never metadata, secrets or structured answers. [Composer references](flower-composer-references.md#reference-drafts) owns draft scope.

### Keyboard interaction
Unmodified ArrowUp in an exactly empty textarea recalls newest eligible text. Whitespace counts as a nonempty draft. Thread changes reset history browsing while retaining each draft.

### Presentation
Contextual PromptCard has no placeholder and opens with the real editor caret; ordinary conversation composers retain their localized concise placeholder. Recall restores no attachments or canonical mutations.

# Boundaries

Composer drafts and the transport outbox own only unconfirmed browser input, stable request identity, and presentation-only launch settings. They never become authorization evidence or canonical queue, interaction, effect, turn, Thread settings, or Agent lifecycle state. Secret answers bypass the outbox, and canonical confirmation or terminal cleanup removes transport state instead of projecting a second durable command.

Recall never submits, changes canonical messages, restores attachments or overwrites a nonempty draft. Scope, availability, candidate or external-draft changes end browsing while preserving current text.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Source.

- `redeven:internal/flower_ui/src/composer/flowerInputHistory.test.ts` - Tests.

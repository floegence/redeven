---
type: UI Contract
title: Flower composer attachments
tags: [ui, flower, attachments, composer, accessibility]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

One Flower controller owns attachment select/paste/drop/retry/remove/preview/send. Hosts authenticate staging; Redeven owns bytes/unadmitted commands, Floret admitted history. Large text converts only after successful staging, retaining IME and source on failure.

# Contract

The chat toolbar always retains its leftmost Plus attachment button. Thread-detail loads, model-capability refreshes and temporary editing restrictions disable it without removing its DOM node or shifting the toolbar. Every editable conversation can select attachments once its transport and capability are ready; read-only and unavailable states keep the same visible, disabled entry. Drafts and staged files remain scoped to their conversation.

Text above 50,000 Unicode code points converts only after successful staging.

Selection during capability loading retains queued local bytes. Invalid Unicode, drift, quota, upload/restore or pre-capture failure preserves the editor. Once captured, the transport outbox owns submission and explicit recovery; later failures never overwrite newer composer edits. Attachment-only sends never synthesize prompts; restoration never sends automatically.

All file types remain selectable and sendable regardless of model modalities or tool support. Upload limits and transport readiness remain authoritative; presentation routes never mark staged files incompatible. Model changes, revision changes and capability refreshes preserve staged readiness without uploading again. The model menu does not pre-judge attachment support or poll each model for attachment compatibility. Desktop IPC and Env App preview loaders accept canonical opaque bytes; preview availability does not decide whether a file can be sent. Models receive native content when supported or an honest attachment manifest and choose how to process it.

## Connection-local editing
Env App uses one Shell-owned coordinator across Activity/Workbench; Desktop uses one per connection, never a module singleton. Admission uncertainty retains request identity for reconciliation/retry.

## Queued content
Execution leaves select/paste/drop/reference controls usable. Users may add/remove/send resources; staged copies survive queue removal and canonical bytes remain immutable.

## Canonical Presentation
Previews use authenticated `loadMessageAttachment`: Env App prepares local credentials; Desktop uses scoped Runtime IPC GET with bounded canonical-MIME bytes. Chromium coverage includes 320 CSS pixels without horizontal overflow.

# Boundaries

The shared Flower UI owns attachment presentation, connection-local interaction state, and ordered controller behavior. Floret alone owns canonical turn membership and admitted attachment history.

Canonical timeline projection does not fall back to a staged client snapshot when Floret membership is unavailable.

# Evidence

- `redeven:internal/flower_ui/src/attachments/flowerAttachmentModel.ts` - Source.
- `redeven:internal/flower_ui/src/attachments/FlowerAttachmentLane.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerStability.browser.test.tsx` - Delayed thread/model navigation, persistent button identity, upload and draft isolation across desktop, mobile and companion layouts.

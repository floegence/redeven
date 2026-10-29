---
type: UI Contract
title: Flower composer attachments
tags: [ui, flower, attachments, composer, accessibility]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower owns connection-local attachment editing; host adapters authenticate staging, Redeven owns staged bytes/unadmitted commands and Floret owns admitted history. Select, paste, drop, retry, remove, preview and attachment-only send share one controller. Text above 50,000 Unicode code points converts only after successful staging, preserving IME and source text on failure.

# Contract

Selection during capability loading retains queued local bytes. Invalid Unicode, drift, quota, upload/restore or pre-capture failure preserves the editor. Once captured, the transport outbox owns submission and explicit recovery; later failures never overwrite newer composer edits. Attachment-only sends never synthesize prompts; restoration never sends automatically.

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

- `redeven:internal/flower_ui/src/attachments/flowerAttachmentModel.ts` - Unicode, selection, capability, route, and staged-identity helpers define shared semantics.

- `redeven:internal/flower_ui/src/attachments/FlowerAttachmentLane.tsx` - The accessible attachment lane presents bounded item states and icon actions.

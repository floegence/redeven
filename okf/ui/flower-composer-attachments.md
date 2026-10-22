---
type: UI Contract
title: Flower composer attachments
description: Connection-local attachment staging, long-text conversion, and canonical timeline presentation.
tags: [ui, flower, attachments, composer, accessibility]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Flower owns connection-local editing, its host adapter owns authenticated staging transport, Redeven owns staged bytes and unadmitted commands, and Floret owns admitted attachment history.
- Outcome: file selection, drag-and-drop, paste, progress, retry, removal, preview, reference copy, attachment-only send, and long-text restore behave consistently in Activity, Workbench, Desktop, and mobile layouts.
- Invariants: text is converted only above 50,000 Unicode code points, IME composition is never interrupted, and source text is not cleared until staging succeeds.
- Failure boundary: invalid Unicode, capability drift, quota, upload, restore, or pre-acceptance failure preserves the connection-local editor and never synthesizes user text.

# Contract

An attachment selected while the model capability snapshot is loading stays queued with its local bytes.

Attachment-only turns are valid and never receive invented prompt copy.

No automatic Send occurs during restoration.

## Connection-local editing
Activity and Workbench use one Env App shell-owned in-memory coordinator; Desktop uses one App-owned coordinator per connection. A Flower surface never creates a module singleton.

Admission uncertainty preserves that product request identity in the live connection so retry and reconciliation cannot silently create another request.

## Queued content
Active execution keeps file selection, paste, drag-and-drop and reference controls available. Users can remove or add resources and send normally; staged copies remain usable after the queue item is removed, while canonical attachment bytes stay immutable.

## Canonical Presentation
Message attachment previews cross the host's authenticated `loadMessageAttachment` boundary. Env App prepares its local access credentials; Desktop sends a scoped GET through Runtime IPC and receives bounded bytes with the canonical MIME type.

A real Chromium 320-CSS-pixel layout check covers common desktop 400-percent zoom width without horizontal overflow.

# Boundaries

The shared Flower UI owns attachment presentation, connection-local interaction state, and ordered controller behavior. Floret alone owns canonical turn membership and admitted attachment history.

Canonical timeline projection does not fall back to a staged client snapshot when Floret membership is unavailable.

# Evidence

- `redeven:internal/flower_ui/src/attachments/flowerAttachmentModel.ts` - Unicode, selection, capability, route, and staged-identity helpers define shared semantics.

- `redeven:internal/flower_ui/src/attachments/createFlowerAttachmentController.ts` - Ordered upload, progress, retry, cancel, remove, restore, and capability transitions share one controller.

- `redeven:internal/flower_ui/src/attachments/FlowerAttachmentLane.tsx` - The accessible attachment lane presents bounded item states and icon actions.

---
type: UI Contract
title: Flower composer attachments
description: Connection-local attachment staging, long-text conversion, and canonical timeline presentation.
tags: [ui, flower, attachments, composer, accessibility]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

- Authority: Flower owns connection-local editing, its host adapter owns authenticated staging transport, Redeven owns staged bytes and unadmitted commands, and Floret owns admitted attachment history.
- Outcome: file selection, drag-and-drop, paste, progress, retry, removal, preview, reference copy, attachment-only send, and long-text restore behave consistently in Activity, Workbench, Desktop, and mobile layouts.
- Invariants: text is converted only above 50,000 Unicode code points, IME composition is never interrupted, and source text is not cleared until staging succeeds.
- Failure boundary: invalid Unicode, capability drift, quota, upload, restore, or pre-acceptance failure preserves the connection-local editor and never synthesizes user text.

# Contract

The attachment lane is part of the composer rather than a separate modal workflow. Each item has a stable size, status, progress treatment, and icon action set. File selection, drop, and paste converge on the same controller and closed capability snapshot. Upload order is preserved independently of completion order. Failed items retain retry or reselect actions, cancellation is immediate, incompatible items remain legible, and sending is enabled only when every included item is ready. Attachment-only turns are valid and never receive invented prompt copy.

The inline threshold is exactly 50,000 Unicode code points. Exactly 50,000 stays inline. A paste payload that alone exceeds the threshold is staged as one lossless UTF-8 `long_text` attachment while the surrounding selection remains in the editor. If attachments are unavailable, browser paste remains untouched; if local limits reject conversion, the exact payload, surrounding text, and selection are restored. Typing, restoration, or a smaller paste that makes the whole editor value exceed the threshold keeps the editor intact and shows a restrained conversion status; Send stages the complete original scalar string first. Raw whitespace and newlines over the limit remain valid long text even though trimmed prompt text is empty. During preparation the primary action becomes Stop. Cancellation, a new approval or input request, read-only transition, detail load, or warmup aborts the exact generated upload, preserves the original editor value before admission, and permits an explicit retry. Lone UTF-16 surrogates fail before encoding, and composition events suppress conversion and submission until `compositionend` updates the same connection-local scope.

Long-text source keeps original whitespace and newline bytes. Until Send is accepted, the item offers Restore to editor. Restore reads the exact owner-and-staging-scope-bound text with the connection-held capability, verifies its digest, inserts it at the current selection, and removes the staging membership. Ordinary remove updates the local scope and releases that membership; abandoned late upload completion uses the same idempotent staged cleanup path. A subsequent Send may stage the current complete editor value again. Names are presentation only and include a timestamp plus collision ordinal.

## Connection-local editing

Activity and Workbench use one Env App shell-owned in-memory coordinator; Desktop uses one App-owned coordinator per connection. A Flower surface never creates a module singleton. The coordinator starts empty, is not hydrated by the host, and is disposed with the connection. All placements that open the same thread or new-thread scope synchronously observe one cell, including across page switches and retained-surface remounts. Different scopes and different connections are isolated. There is no server draft, lease, holder, expected revision, takeover, conflict state, store-unavailable state, polling, or persistence retry. Picker activation happens in the originating click task, while captured files, focus, and text selection apply only to the same connection-local scope.

The shared in-memory value contains text, staged attachment projection, references, model, reasoning, permission, working directory, a stable product `client_request_id` or `queue_id`, capability revision, and the local mode. It never persists file handles, editable text, references, or turn history. Each composer scope obtains a separate random staging scope and bearer capability, held only in connection memory. Existing-thread staging binds the exact Floret ThreadID; a new-conversation staging scope binds the stable client request target and carries no candidate canonical identity. Admission uncertainty preserves that product request identity in the live connection so retry and reconciliation cannot silently create another request.

## Canonical Presentation

Queued rows are Redeven-owned unadmitted projections reconstructed from immutable commands and exact resource metadata. Admitted rows come only from Floret public reads and display canonical attachment name, MIME, size, text statistics, and optional logical locator. Staged preview uses authenticated fetch with exact scope and capability headers, then opens a short-lived Blob or a bounded Desktop temporary file; the bearer capability never enters a URL, query, body, DOM attribute, receipt, or persisted command. Queued preview carries thread and queue, and canonical preview carries thread and turn. Download or preview actions reauthenticate and do not treat a locator as identity. The authenticated response's canonical media type, never the display-name suffix, selects a fixed safe temporary extension; plain text is always `.txt`, while HTML, SVG, missing, or non-canonical media types fail closed before a temporary directory is created. Model capability changes mark staged items incompatible rather than silently dropping them. While the model menu is open, each option checks current MIME routes, long-text support, count, per-file size, and total size and labels support, rejection, loading, or an unavailable check without switching models automatically.

Desktop upload operations permit only one in-flight binary chunk write per operation id. A concurrent chunk is rejected before either offset state or the runtime socket can be touched, while different operations remain independent. If the commit request receives an HTTP 423 challenge, the main process invalidates only the challenged runtime's cached access cookie and returns the failure to the UI. An explicit retry keeps the server idempotency key and runs access preparation again; Desktop never transparently replays a request body after transmission.

All visible strings, tooltips, error states, progress labels, and accessibility names use the shared locale catalog. Item names include IEC size, localized line count, MIME, and state in their accessible name; polite announcements cover add, conversion, completion, and failure. Picker completion returns focus to the composer. The lane wraps on narrow screens, keeps touch targets stable, and does not expand controls when status text changes. A real Chromium 320-CSS-pixel layout check covers common desktop 400-percent zoom width without horizontal overflow.

# Boundaries

The shared Flower UI owns attachment presentation, connection-local interaction state, and ordered controller behavior. Host adapters own authenticated staging transport, progress delivery, preview handoff, and platform-specific temporary-file lifecycle. The Redeven AI service owns bytes, owner-scoped metadata, quotas, staging capability hashes, claims, integrity checks, and unadmitted command admission. Floret alone owns canonical turn membership and admitted attachment history.

A surface never persists file bytes or editable state, creates its own global coordinator, treats a locator or scope id as authorization, invents prompt text for an attachment-only turn, or admits an unresolved or incompatible item. Env App and Desktop integrations do not reinterpret attachment controller states or expose the staging bearer secret outside the fixed authorization header boundary. Canonical timeline projection does not fall back to a staged client snapshot when Floret membership is unavailable.

# Evidence

- `redeven:internal/flower_ui/src/attachments/flowerAttachmentModel.ts` - Unicode, selection, capability, route, and staged-identity helpers define shared semantics.
- `redeven:internal/flower_ui/src/attachments/createFlowerAttachmentController.ts` - Ordered upload, progress, retry, cancel, remove, restore, and capability transitions share one controller.
- `redeven:internal/flower_ui/src/attachments/FlowerAttachmentLane.tsx` - The accessible attachment lane presents bounded item states and icon actions.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - One connection-local in-memory cell coordinates Activity and Workbench without persistence or editor ownership.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerAutosizeController.ts` - Measured visual-line sizing grows through five lines and then enables internal scrolling.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Composer events, long-text conversion, admission, and canonical timeline projection are integrated in one surface.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Env App owns the shared Flower draft coordinator above Activity and Workbench placement.
- `redeven:desktop/src/welcome/App.tsx` - Desktop owns one draft coordinator for its Flower surfaces.
- `redeven:desktop/src/main/runtimeFlowerAttachmentOperationLifecycle.ts` - Desktop operation lifecycle serializes chunk writes for one upload.
- `redeven:desktop/src/main/runtimeFlowerHTTP.ts` - HTTP 423 invalidates only the challenged runtime access cache entry.
- `redeven:internal/flower_host_ui/src/flowerAttachmentStaging.ts` - Hosts validate staging responses and place scope identity plus bearer authority only in fixed headers.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Env preview authenticates a fetch before creating a short-lived Blob URL.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerAttachments.browser.test.tsx` - Chromium verifies narrow and 400-percent-equivalent attachment layout containment.

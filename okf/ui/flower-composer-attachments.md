---
type: UI Contract
title: Flower composer attachments
description: Shared attachment staging, long-text conversion, draft leases, and canonical timeline presentation.
tags: [ui, flower, attachments, composer, accessibility]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

- Authority: the shared Flower composer owns transient draft interaction, while its host adapter owns transport and Floret owns admitted attachment history.
- Outcome: file selection, drag-and-drop, paste, progress, retry, removal, preview, reference copy, attachment-only send, and long-text restore behave consistently in Activity, Workbench, Desktop, and mobile layouts.
- Invariants: text is converted only above 50,000 Unicode code points, IME composition is never interrupted, and source text is not cleared until staging succeeds.
- Failure boundary: invalid Unicode, capability drift, quota, upload, restore, or admission failure preserves a recoverable draft and never synthesizes user text.

# Interaction Contract

The attachment lane is part of the composer rather than a separate modal workflow. Each item has a stable size, status, progress treatment, and icon action set. File selection, drop, and paste converge on the same controller and closed capability snapshot. Upload order is preserved independently of completion order. Failed items retain retry or reselect actions, cancellation is immediate, incompatible items remain legible, and sending is enabled only when every included item is ready. Attachment-only turns are valid and never receive invented prompt copy.

The inline threshold is exactly 50,000 Unicode code points. Exactly 50,000 stays inline. A paste payload that alone exceeds the threshold is staged as one lossless UTF-8 `long_text` attachment while the surrounding selection remains in the editor. If attachments are unavailable, browser paste remains untouched; if local limits reject conversion, the exact payload, surrounding text, and selection are restored. Typing, restoration, or a smaller paste that makes the whole draft exceed the threshold keeps the editor intact and shows a restrained conversion status; send stages the complete original scalar string first. Raw whitespace and newlines over the limit remain valid long text even though trimmed prompt text is empty. During preparation the primary action becomes Stop. Cancellation, a new approval or input request, read-only transition, detail load, or warmup aborts the exact generated upload, preserves the original editor value before admission, and permits an explicit retry. Lone UTF-16 surrogates fail before encoding, and composition events suppress conversion and submission until `compositionend` acquires the same draft lease.

Long-text source keeps original whitespace and newline bytes. Until canonical admission, the item offers Restore to editor. Restore reads the exact owner-and-draft-bound staged text, verifies its digest, inserts it at the current selection, and commits removal through the draft revision transaction. Ordinary remove also mutates the draft and releases its claim atomically; only abandoned late upload completion uses the idempotent staged-delete cleanup path. A subsequent send may stage the current complete draft again. Names are presentation only and include a timestamp plus collision ordinal.

# Shared Draft Contract

Activity and Workbench use one Env App shell-owned draft coordinator; Desktop uses one App-owned coordinator. A Flower surface never creates a module singleton. Reading or opening a draft does not take a lease. The first mutation acquires an expiring lease for the exact thread or new-thread scope, and all edits use an expected revision. Another visible surface presents a stable compact conflict state until explicit takeover; a background poll cannot silently make it editable. Takeover continues from the latest shared snapshot; stale or former-owner writes are rejected. Initial store unavailability disables editing with an explicit status. Transient failure after ownership keeps local intents ordered and visible, shows one restrained unsaved status, and serially replays them after reconnect. Send must renew and flush first; it cannot admit a locally projected but unpersisted draft. Picker activation happens in the originating click task, while captured files, focus, and text selection are applied only to the same session after lease acquisition.

The shared snapshot contains text, staged attachment projection, model, reasoning, permission, working directory, proposed TurnID, capability revision, and the local mode. It does not persist file bytes or turn history. Browser `File` handles are renderer-local and a remount may require reselection, while an already staged server attachment remains identified by its opaque id. New-thread send first persists one target thread id in the draft, then performs durable thread creation and turn admission with the returned revision. Admission uncertainty keeps that target and the exact proposed TurnID for public pending/canonical reconciliation instead of silently restoring or duplicating the draft.

# Canonical Presentation

Queued rows are Redeven-owned unadmitted projections reconstructed from queued commands and exact resource metadata. Admitted rows come only from Floret public reads and display canonical attachment name, MIME, size, text statistics, and optional logical locator. Staged preview carries the exact draft audience, queued preview carries thread and queue, and canonical preview carries thread and turn. Download or preview actions reauthenticate and do not treat a URL as identity. Env App preview opens a same-runtime URL carrying the one-use local-access resume query; the local access boundary exchanges it for the HttpOnly session cookie before the protected attachment request, so a password-protected environment does not leave the new window at HTTP 423. Desktop preview uses authenticated main-process IPC, writes a `0600` bounded temporary file, opens it through the operating system, and removes it after a short retention interval; a `file://` renderer never opens a relative runtime URL. The authenticated response's canonical media type, never the display-name suffix, selects a fixed safe temporary extension; plain text is always `.txt`, while HTML, SVG, missing, or non-canonical media types fail closed before a temporary directory is created. Model capability changes mark staged items incompatible rather than silently dropping them. While the model menu is open, each option checks current MIME routes, long-text support, count, per-file size, and total size and labels support, rejection, loading, or an unavailable check without switching models automatically.

Desktop upload operations permit only one in-flight binary chunk write per operation id. A concurrent chunk is rejected before either offset state or the runtime socket can be touched, while different operations remain independent. If the commit request receives an HTTP 423 challenge, the main process invalidates only the challenged runtime's cached access cookie and returns the failure to the UI. An explicit retry keeps the server idempotency key and runs access preparation again; Desktop never transparently replays a request body after transmission.

All visible strings, tooltips, error states, progress labels, and accessibility names use the shared locale catalog. Item names include IEC size, localized line count, MIME, and state in their accessible name; polite announcements cover add, conversion, completion, and failure. Picker completion returns focus to the composer. The lane wraps on narrow screens, keeps touch targets stable, and does not expand controls when status text changes. A real Chromium 320-CSS-pixel layout check covers common desktop 400-percent zoom width without horizontal overflow.

# Evidence

- `redeven:internal/flower_ui/src/attachments/flowerAttachmentModel.ts` - Unicode, selection, capability, route, and staged-identity helpers define shared semantics.
- `redeven:internal/flower_ui/src/attachments/createFlowerAttachmentController.ts` - Ordered upload, progress, retry, cancel, remove, restore, and capability transitions share one controller.
- `redeven:internal/flower_ui/src/attachments/FlowerAttachmentLane.tsx` - The accessible attachment lane presents bounded item states and icon actions.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Revisioned draft leases coordinate Activity and Workbench without a singleton.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Composer events, long-text conversion, admission, and canonical timeline projection are integrated in one surface.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Env App owns the shared Flower draft coordinator above Activity and Workbench placement.
- `redeven:desktop/src/welcome/App.tsx` - Desktop owns one draft coordinator for its Flower surfaces.
- `redeven:desktop/src/main/runtimeFlowerAttachmentOperationLifecycle.ts` - Desktop operation lifecycle serializes chunk writes for one upload.
- `redeven:desktop/src/main/runtimeFlowerHTTP.ts` - HTTP 423 invalidates only the challenged runtime access cache entry.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Env preview carries the local-access resume query into the protected new window.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.composerAttachments.browser.test.tsx` - Chromium verifies narrow and 400-percent-equivalent attachment layout containment.

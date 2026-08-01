---
type: AI Resource Contract
title: Flower attachment resources
description: Owner-scoped uploads, canonical membership, provider reads, quotas, and last-reference cleanup.
tags: [ai, flower, attachments, storage, security]
timestamp: 2026-07-27T00:00:00Z
---
# Summary

- Authority: Redeven owns attachment bytes, metadata, owner scope, quota, and retention claims; Floret owns the canonical turn and attachment membership.
- Outcome: clients upload bytes once and send opaque `attachment_id` values, while Flower displays an `attachment://v1/...` locator and providers receive only revalidated canonical resources.
- Invariants: physical paths never leave the service, user ownership comes only from the authenticated session, and a product claim never substitutes for an exact Floret membership read.
- Failure boundary: owner mismatch, unsupported media, quota exhaustion, missing canonical membership, metadata drift, digest drift, or missing bytes fails closed without weakening another reference.

# Contract

Redeven threadstore product v1 stores generated attachment identity, the authenticated user owner scope, a server-only relative storage name, sanitized display metadata, exact byte size, SHA-256, optional strict UTF-8 code-point and logical-line counts, source, state, idempotency identity, and retention claims. Every upload is written with its immutable digest and applicable text metadata from the start. The only owner scope is `user`; channel and session identities are request credentials, not durable resource owners. The first-release baseline contains no legacy owner scope, quarantine state, digest sealing operation, compatibility parser, or historical upload migration.

`attachment_id` is an opaque request identity. The canonical Floret `ResourceRef` is content-addressed and the display locator is `attachment://v1/<attachment-id>/<encoded-name>`. Neither value grants access. The upload directory and relative storage name are never returned. Staged transport requires one exact staging-scope id plus its plaintext capability in fixed headers; the server also binds endpoint, authenticated owner, target thread, expiry, and the stored capability hash. Missing, duplicate, mismatched, released, or expired headers fail closed. Queued transport requires exact `thread_id + queue_id`; canonical transport requires exact `thread_id + turn_id`. Preview changes only content disposition. Every canonical read obtains exact membership from public Floret authority before checking product claims, owner rules, metadata, size, and digest.

Uploads are streamed through a bounded multipart request into a `0600` temporary file while Redeven computes size, digest, UTF-8 validity, code-point count, CRLF-aware logical line count, and a closed media classification. Every strict UTF-8 `text/*`, including active HTML and XML media, is stored and served canonically as `text/plain; charset=utf-8`. Commit requires the declared length, content digest, normalized display-name digest, and idempotency fingerprint to match. Response-loss replay returns the committed record; a conflicting replay fails explicitly. Upload completion creates only an owner-bound staging claim. Clicking Send atomically validates canonical upload metadata and transfers the selected claims to one immutable queued command; it does not persist the editable text or attachment presentation as a draft.

The authenticated preview route uses a closed inline allowlist: canonical plain text, PNG, JPEG, GIF, WebP, and PDF. Inline responses add a sandboxed content security policy that denies scripts, navigation bases, and form actions. Any unsupported or legacy media value is returned as `application/octet-stream` with attachment disposition, even when old metadata claims HTML, XML, SVG, or another browser-active type. Preview authorization and integrity checks are identical to download; disposition cannot weaken membership or ownership.

Quota checks occur in the same SQLite write transaction as the state change. Staged quota is scoped to unique user-owned resources. First transfer into queued or thread ownership checks unique user live quota and unique thread live quota; duplicate claims do not double count. Releasing or expiring a staging scope removes only that scope's claims. Releasing the final staging, queued, thread, or fork claim moves the resource to deleting and immediately releases live quota. Physical deletion and row removal are idempotent and retryable. Thread deletion releases its thread claim only after Floret deletion succeeds and preserves bytes still referenced by another thread, fork, queued command, or live staging scope.

Every initial, queued, follow-up, replacement, RPC, and service admission path rechecks the exact staging capability when attachments are present, owner, target thread, attachment state, count, aggregate 25 MiB limit, model-scoped route, capability revision, and canonical upload metadata in the claiming transaction. Inline text over 50,000 Unicode code points is rejected with the stable `long_text_attachment_required` code even when a client bypasses the composer. A prepared long-text attachment is accepted only when its staged bytes and text statistics exactly match the submitted text. New-thread settings, create operation, immutable command, and staging transfer commit atomically, so pre-commit rejection leaves no partial thread.

## Provider Preparation

Redeven derives one model-scoped capability snapshot from the selected provider route and model modalities. The revision binds the exact MIME route matrix and product limits. A native image or file route is advertised only when the provider adapter can render and conservatively estimate that complete request. Strict UTF-8 text may instead use the bounded `attachment.read` host tool. Binary, image, and PDF content never use the text fallback.

Floret v3.0.3 receives only canonical descriptors and owns their durable association, replay, fork, retry, SubAgent, and prompt-cache identity. A known-Turn attachment read uses one identity-bound exact turn read and never falls back to history pages; only typed not-found is absence, while authority, storage, and corruption failures remain unavailable errors. An unknown-Turn attachment lookup may scan canonical turn pages because the provider locator lacks source Turn identity; it never consults a Redeven message table. Redeven opens and hashes bytes after Floret selects the exact request and before provider dispatch through the prepared-request contract. The prepared request freezes the fully rendered provider payload, estimate, and fingerprint, is consumed at most once, and is closed on every non-stream path. Historical reads repeat canonical membership and byte-integrity checks rather than trusting admission-time state.

# Boundaries

Redeven does not inspect or migrate Floret storage, persist message ordering, expose a filesystem path, accept a client owner, authorize by locator, or infer canonical membership from its claim table. Floret does not upload, store, classify, quota, download, or delete Redeven resources. Desktop transports attachment bytes in offset-checked binary IPC chunks; Env App uses authenticated multipart XHR with progress and cancellation. Neither transport embeds bytes or a URL identity in a turn JSON body.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Product v1 declares user-owned attachment resources, attempts, claims, and neutral staging targets without legacy upload shapes.
- `redeven:internal/ai/threadstore/upload_staging.go` - Staging capability hashes, exact claims, release, and atomic command transfer are enforced in the resource store.
- `redeven:internal/ai/threadstore/uploads.go` - Transactional idempotency, quotas, claims, and last-reference deletion are enforced in the resource store.
- `redeven:internal/ai/uploads.go` - Upload streaming, classification, integrity, locator, and canonical live reads are implemented at the host boundary.
- `redeven:internal/ai/upload_staging.go` - The service creates, authorizes, reads, deletes, and releases capability-bound staging scopes.
- `redeven:internal/ai/floret_attachments.go` - Canonical descriptors and post-admission byte validation bridge Redeven resources into Floret requests.
- `redeven:internal/ai/floret_provider.go` - Prepared provider requests freeze rendered attachment payloads and conservative estimates.
- `redeven:internal/codeapp/appserver/server.go` - Authenticated upload, capability, download, range, restore, and delete routes expose stable envelopes.
- `redeven:internal/ai/threadstore/thread_create_operation_test.go` - First-release staging target rebinding and atomic create materialization are covered transactionally.
- `redeven:internal/codeapp/appserver/server_ai_uploads_test.go` - Preview tests pin the closed inline media set, forced download fallback, and sandbox CSP.
- `redeven:desktop/src/shared/runtimeFlowerAttachmentIPC.ts` - Desktop validates ordered binary attachment operations without JSON or base64 payloads.
- `redeven:internal/envapp/ui_src/src/ui/services/localApi.ts` - Env App uses authenticated multipart XHR with progress and cancellation.

---
type: AI Resource Contract
title: Flower attachment resources
tags: [ai, flower, attachments, storage, security]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns authenticated bytes/metadata/quotas/retention; Floret turn membership. Upload once, submit opaque attachment_id, render attachment://v1 and revalidate provider resources. Admit files independently of model modalities/tools. Preserve recognized text/image/PDF types; other files, including Office and non-UTF-8 documents, keep original bytes/name as application/octet-stream.

# Contract

## Identity and provider preparation
Redeven product threadstore v1 owns generated attachment ID, authenticated user hash, private relative storage name, detected/sanitized media metadata, exact size/SHA-256, optional strict UTF-8 code-point/line counts, source/state/idempotency and retention claims. Floret ResourceRef is content-addressed; display locator is attachment://v1/<attachment-id>/<encoded-name>. Retention never authorizes canonical reads.

Active UTF-8 uses text/plain; pasted long text requires strict UTF-8. Queue/admission enforce owner, staging, count and byte bounds, not a model MIME allowlist.

Capabilities affect presentation only. Supported modalities receive native content; otherwise the owning user message/tool result receives a factual manifest: name, media_type, size_bytes, locator, content_included:false, content_trust:untrusted. It adds no system message, tool-selection instruction or generic failure advice. Tool definitions own access guidance; manifest implies neither extraction, tool availability nor parser installation. The model chooses tools or explains its limitation. Switching models never rejects retained attachments/images; verify canonical descriptors/digest before the same manifest fallback, preserving native rendering for capable models.

## Reads and copies
Historical reads revalidate membership and bytes. Upload/image lookup uses current-path public Floret windows (50 items, 128-byte previews), one authorized subscription and page/stable-leaf correlation; no full hydration or retention-inventory authorization. Resolved handles prove ownership/metadata only. Hash during materialization; provider/text/image consumers verify their exact snapshots and downloads verify before returning paths. Avoid prehash plus reread. Bound size/cancellation; corrupt bytes never publish a copy.

Floret v7.51.1 exposes user and confirmed tool descriptors canonically. Retention distinguishes tool media from uploads; never parse image refs as upload rows.

attachment.materialize requires current execution/canonical authorization, RWX and normal write policy. Create a unique regular scratch copy using cancellable 32 KiB streaming with exact size/SHA-256; image locators retain bounded validation. Failure deletes private staging, repeated names never overwrite edited copies, and output exposes only the work path.

## Lifetime
Cleanup removes work copies, never original inputs/images. Retained references permit rematerialization after cleanup/restart/compaction/parent deletion. Historical Fork inherits refs only through its canonical cut and separately copies current scratch/staging. Product settings/claims publish transactionally without another admitted-message map.

Files derives input/media pages from public windows with current product authorization. Last-reference inventory includes inactive paths/queued inputs but grants no read authority. External files/deliveries retain destinations and survive cleanup. Existing upload/media backup scope excludes disposable task files.

# Boundaries

Attachment staging capabilities travel only through `Upload-Staging-Capability`.
Both the server proxy allowlist and Floe's browser response policy explicitly retain
that field across local HTTP, TLS, private bridge and remote connections. The
capability remains in memory; it is never copied into URLs or canonical context.

Redeven does not inspect or migrate Floret storage, persist message ordering, expose a filesystem path, accept a client owner, authorize by locator, or infer canonical membership from its claim table. Neither transport embeds bytes or a URL identity in a turn JSON body.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Product v1 attachment ownership, attempts, claims and neutral staging.

- `redeven:internal/ai/threadstore/uploads.go` - Source.

- [No-native/no-tools provider preparation and historical manifest tests](../../internal/ai/attachment_manifest_test.go).

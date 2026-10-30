---
type: AI Resource Contract
title: Flower attachment resources
tags: [ai, flower, attachments, storage, security]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Redeven owns bytes/metadata, authenticated owner, quotas and retention; Floret owns turn membership. Upload once, send opaque attachment_id, display attachment://v1 locators and revalidate provider resources. Never expose paths or substitute product claims for canonical membership. Owner/media/quota/membership/metadata/digest/byte failures reject only the affected reference.

# Contract

Redeven threadstore product v1 stores generated attachment identity, the authenticated user hash, a server-only relative storage name, sanitized detected media metadata, exact byte size, SHA-256, optional strict UTF-8 code-point and logical-line counts, source, state, idempotency identity, and retention claims.

The canonical Floret `ResourceRef` is content-addressed and the display locator is `attachment://v1/<attachment-id>/<encoded-name>`.

Retention ownership does not authorize canonical reads.

## Provider Preparation
Upload admission is independent of provider-native modalities. Recognized text, image and PDF bytes retain their safe canonical types; all other files, including Office containers and non-UTF-8 documents, use `application/octet-stream` with their original names and bytes. Active UTF-8 text remains `text/plain`; pasted long text must still be strict UTF-8. Size, ownership, digest, staging and retention checks are unchanged.

Redeven derives one model-scoped capability snapshot from the selected provider route and model modalities. Native image/text/PDF input takes precedence when supported. Tool-capable models receive other attachments as canonical manifests: strict UTF-8 text uses bounded `attachment.read`; binary files use `attachment.materialize` and model-selected processing tools. A manifest is not extracted content or a promise that a parser is installed. Materialization retains its normal permissions. Models without either a native route or tools remain unsupported.

Historical reads repeat canonical membership and byte-integrity checks rather than trusting acceptance-time state. Upload/tool-image reads search current-path public Floret windows (50 items, 128-byte previews) through one authorized subscription, correlated to each requested page and a stable leaf. They never hydrate full history or authorize from retention inventory. The internal resolved handle certifies ownership and metadata only: materialization hashes while copying, text/provider/image consumers verify their exact snapshot, and public download opens verify bytes before returning a path. Thus upload materialization does not prehash and then reread the original. Reads honor cancellation and declared-size bounds; corruption never publishes a work copy.

## Canonical image recovery
Floret v7.51.1 exposes user and confirmed tool attachment descriptors through one canonical view. Upload retention recognizes tool media separately and never parses tool image references as upload records.

## Local processing and lifecycle

Immutable originals and mutable working copies share canonical thread references but have different lifetimes. attachment.materialize reauthorizes the execution identity and canonical attachment, requires RWX and the normal write-effect policy, then creates a unique regular work copy under the current thread scratch directory. Upload copies stream through a 32 KiB buffer with cancellation, exact size and SHA-256 validation. Image locators reuse bounded canonical image validation. Failed copies remove private staging; repeated same-name inputs never overwrite edited copies. Only the working path is returned, never the original backing path.

Working-file cleanup deletes copies, not inputs or historical images. Originals can be materialized again after cleanup, restart, compaction or parent deletion when another conversation retains them. Historical Fork inherits input references only through its canonical cut and independently copies current scratch/staging. Product settings and upload claims publish transactionally; no second admitted-message mapping is stored.

The Files panel derives input/media pages from the public Floret window interface with fresh product authorization. The last-reference inventory remains separate and includes inactive paths and queued inputs. External referenced files and delivered outputs keep their existing destinations and are never removed by conversation cleanup. Existing upload/media backup scope is unchanged; disposable task files are not added to backups.

# Boundaries

Redeven does not inspect or migrate Floret storage, persist message ordering, expose a filesystem path, accept a client owner, authorize by locator, or infer canonical membership from its claim table. Neither transport embeds bytes or a URL identity in a turn JSON body.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Product v1 declares user-owned attachment resources, attempts, claims, and neutral staging targets without legacy upload shapes.

- `redeven:internal/ai/threadstore/uploads.go` - Transactional idempotency, quotas, claims, and last-reference deletion are enforced in the resource store.

- [Materialization and integrity tests](../../internal/ai/attachment_materialize_test.go).
- [Opaque upload, provider-visible manifest, tool execution and restart tests](../../internal/ai/attachment_binary_test.go).
- [Fork cuts, cleanup and last-reference tests](../../internal/ai/task_materials_test.go).
- [Image compaction/restart qualification](../../internal/ai/tool_image_compaction_test.go).

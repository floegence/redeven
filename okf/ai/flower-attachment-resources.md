---
type: AI Resource Contract
title: Flower attachment resources
description: Owner-scoped uploads, canonical membership, provider reads, quotas, and last-reference cleanup.
tags: [ai, flower, attachments, storage, security]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns bytes/metadata, authenticated owner, quotas and retention; Floret owns turn membership. Upload once, send opaque attachment_id, display attachment://v1 locators and revalidate provider resources. Never expose paths or substitute product claims for canonical membership. Owner/media/quota/membership/metadata/digest/byte failures reject only the affected reference.

# Contract

Redeven threadstore product v1 stores generated attachment identity, the authenticated user hash, a server-only relative storage name, sanitized detected media metadata, exact byte size, SHA-256, optional strict UTF-8 code-point and logical-line counts, source, state, idempotency identity, and retention claims.

The canonical Floret `ResourceRef` is content-addressed and the display locator is `attachment://v1/<attachment-id>/<encoded-name>`.

Retention ownership does not authorize canonical reads.

## Provider Preparation
Redeven derives one model-scoped capability snapshot from the selected provider route and model modalities. Strict UTF-8 text may instead use the bounded `attachment.read` host tool.

Historical reads repeat canonical membership and byte-integrity checks rather than trusting acceptance-time state.

## Canonical image recovery
Floret v7.51.1 exposes user and confirmed tool attachment descriptors through one canonical view. Upload retention recognizes tool media separately and never parses tool image references as upload records.

# Boundaries

Redeven does not inspect or migrate Floret storage, persist message ordering, expose a filesystem path, accept a client owner, authorize by locator, or infer canonical membership from its claim table. Neither transport embeds bytes or a URL identity in a turn JSON body.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Product v1 declares user-owned attachment resources, attempts, claims, and neutral staging targets without legacy upload shapes.

- `redeven:internal/ai/threadstore/uploads.go` - Transactional idempotency, quotas, claims, and last-reference deletion are enforced in the resource store.

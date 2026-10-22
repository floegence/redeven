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

- Authority: Redeven owns attachment bytes, metadata, owner scope, quota, and retention claims; Floret owns the canonical turn and attachment membership.
- Outcome: clients upload bytes once and send opaque `attachment_id` values, while Flower displays an `attachment://v1/...` locator and providers receive only revalidated canonical resources.
- Invariants: physical paths never leave the service, user ownership comes only from the authenticated session, and a product claim never substitutes for an exact Floret membership read.
- Failure boundary: owner mismatch, unsupported media, quota exhaustion, missing canonical membership, metadata drift, digest drift, or missing bytes fails closed without weakening another reference.

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

- `redeven:internal/ai/threadstore/upload_staging.go` - Staging capability hashes, exact claims, release, and atomic command transfer are enforced in the resource store.

- `redeven:internal/ai/threadstore/uploads.go` - Transactional idempotency, quotas, claims, and last-reference deletion are enforced in the resource store.

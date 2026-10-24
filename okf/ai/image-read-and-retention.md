---
type: AI Media Contract
title: Direct image reading and tool media retention
description: Authorized image reads produce immutable native model attachments with canonical retention and preview membership.
tags: [ai, tools, images, media, security]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

image.read inspects authorized files/snapshots. Redeven owns bytes/authorization;
Floret owns history/membership. File references stay references; results use native
images, not browsers, temporary servers or Base64 result JSON. Original snapshots
remain available after model preparation.

# Contract

- File mode accepts file_path and optional target_id; locator mode requires a
  canonical media:v1 locator, excludes file_path/target_id, and reuses original
  bytes without reopening the source. Default behavior remains unchanged.
- Every permission mode checks image capability, CanRead, filesystem scope and
  ToolTargetPolicy. Unavailable explicit targets fail without device fallback.
- File reads retain their 10 MiB bound; Computer snapshots retain 16 MiB.
- Locator-only crop accepts integer x/y/width/height within original image pixels,
  never clips, and saves a new lossless PNG with source_crop metadata. It uses
  fresh canonical authorization. Image pixels differ from CSS action coordinates.
- Ordinary image.read results preserve original encoding. Visual summaries may
  optimize Computer frames through [model preparation](computer-use-media.md).
  Original locators remain available; no automatic resizing or derivative cache.
- Floret preserves image order in summaries. Tokens and JSON bytes have separate
  limits; indivisible overflow fails.
- toolMediaStore retains immutable images in computer/keyframes across source
  changes, Retry, restart, Fork and compaction.
- Previews check ownership/canonical membership directly. Markdown images stay unchanged.

# Boundaries

No storage migration, Floret-table queries or second media-membership ledger.

# Evidence

- [Image tool](../../internal/ai/image_read.go)
- [Canonical resolver](../../internal/ai/canonical_image.go)

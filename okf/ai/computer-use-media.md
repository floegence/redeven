---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven owns authorized screenshots; Floret owns history/preparation. Flower
shows frames inline/in Stage. Durable frames and ephemeral samples have separate
lifetimes; tool success does not prove delivery. Model encodings never replace original assets.

# Contract

- Missing, changed or unauthorized bytes fail explicitly. No unrestricted URL fallback.
- [Image reads](image-read-and-retention.md) share immutable Computer storage;
  computer:// identities and retention stay intact.
- Safe results include target, location, summary and safety. Semantic/script
  operations include images only when requested.
- Floret prepares Computer PNGs >=256 KiB as smaller JPEG90 (Go 4:2:0).
  Transparency, dimensions, originals, hashes and visible history stay intact.
- Model notices report dimensions/bytes/encoding; image pixels differ from CSS coordinates.
- Ordinary/summary/Retry/Fork share preparation before estimation/freezing.
  Retries reuse bytes; encoding revisions invalidate provider state. Ordinary
  image.read originals bypass compression.
- Flower caps JSON/base64 at 32 MiB independently of tokens: product policy,
  not a provider limit. Remote DTOs share the cap; services own final rendering.
- Floret compacts complete tool pairs and retains causes. UI provides numeric
  diagnostics and input/model guidance without unchanged Retry or secret payloads.

# Boundaries

The viewer owns no authorization/lifecycle/private takeover pixels. Both hosts
share paths, not authentication. Fixtures do not establish product qualification.

# Evidence

- [Preparation](../../internal/ai/model_image_preparation.go)
- [Media storage](../../internal/ai/computer_media.go)
- [Viewer paths](../../internal/flower_ui/host/computerFramePath.ts)

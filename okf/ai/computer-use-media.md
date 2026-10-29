---
type: Media Contract
title: Computer use media and visual requests
tags: [ai, computer-use, media, attachments]
lifecycle: contract
reviewed_at: "2026-10-29"
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
- All authorized model images use published Floret PrepareModelImage: JPEG quality
  85 and a 2560-pixel longest side, without upscaling. Uploads, image.read/crops,
  browser/native screenshots, MCP images, summaries and historical replay share
  this policy. Alpha remains PNG; EXIF orientation is applied and ICC retained.
  An animation stays byte-identical when it fits; oversized animation fails
  explicitly without flattening frames. An unchanged smaller original may be kept.
- Canonical original bytes, hashes, locators and visible history never change.
  Model notices report source/model dimensions and bytes; fine text can be read
  through an original-backed crop. Preparation never fetches arbitrary URLs.
- Preparation precedes estimation/freezing. Transport retries reuse exact bytes;
  Desktop RPC carries validated derived metadata to prevent lossy recompression.
  Encoding revisions invalidate provider state. No durable derivative cache exists.
- Flower caps JSON/base64 at 32 MiB independently of tokens: product policy,
  not a provider limit. Remote DTOs share the cap; services own final rendering.
- Media dimension/count/byte failures retain typed actual/limit/stage through
  Desktop RPC and canonical failure projection; they are permanent, not token
  overflow. Invalid images report preparation failures. UI provides numeric
  diagnostics and input/model guidance without unchanged Retry or secret payloads.

## Screenshot coordinates
A model screenshot returns frame_geometry with its computer:// identity, original
image dimensions and model_image dimensions. Browser geometry also carries CSS
visual viewport scale/offset. Screenshot handles use model_pixels plus frame and
document_id; explicit browser image_pixels retains original pixel semantics.
Default browser CSS and native window coordinates keep their existing units.
Native window screenshots support model_pixels with a transient window anchor.
Full-page/cropped arbitrary images do not establish an input mapping.

Each controller holds one model anchor. Viewer sampling cannot replace it.
Changed target, document, viewport, bounds or observed native accessibility state
rejects stale input. Input and takeover invalidate the anchor. Known-change
checks cannot eliminate arbitrary dynamic layout races; semantic locators remain
preferable for moving controls. The final attachment supplies after_frame when
several screenshots were taken.

# Boundaries

The viewer owns no authorization/lifecycle/private takeover pixels. Both hosts
share paths, not authentication. Fixtures do not establish product qualification.

# Evidence

- [Preparation](../../internal/ai/model_image_preparation.go)
- [Image ingress and RPC tests](../../internal/ai/model_image_coverage_test.go)
- [Count-boundary Files transport](../../internal/ai/model_gateway_deepseek_files_test.go)
- [Viewer paths](../../internal/flower_ui/host/computerFramePath.ts)

---
type: Media Contract
title: Computer use media and visual requests
tags: [ai, computer-use, media, attachments]
lifecycle: contract
reviewed_at: "2026-10-26"
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

## Browser image coordinates
A model screenshot returns frame_geometry: its existing computer:// resource,
document identity, actual PNG dimensions, CSS visual viewport and image-to-input
scale/offset. Browser image input explicitly supplies coordinate_space:
"image_pixels", frame and document_id. Default coordinates remain browser CSS
viewport pixels or the native adapter's existing units. Native image mode is
rejected before dispatch; full-page/cropped arbitrary images have no input mapping.

The current controller holds one bounded model anchor. Viewer sampling cannot
replace it. Changed target, document, scroll, viewport or scale rejects the image
operation before input. This checks known changes, not arbitrary dynamic layout
races; semantic locators remain preferable for moving controls. Existing model
JPEG preparation preserves dimensions. Script geometry is invalidated after an
action and suppressed after takeover or failed observation. The final attachment
supplies after_frame when several screenshots were taken.

# Boundaries

The viewer owns no authorization/lifecycle/private takeover pixels. Both hosts
share paths, not authentication. Fixtures do not establish product qualification.

# Evidence

- [Preparation](../../internal/ai/model_image_preparation.go)
- [Viewer paths](../../internal/flower_ui/host/computerFramePath.ts)

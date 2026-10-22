---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns screenshot bytes and authorized media resolution; Floret owns opaque
attachment history and provider rendering. Flower displays saved screenshots inline and offers decoded pixels in a
media-only Stage. Durable keyframes and ephemeral viewing samples have distinct
lifetimes. A missing, changed or unauthorized reference fails explicitly and
cannot fall back to an unrestricted image URL. Successful tool metadata alone
does not prove the user can see a frame.

Durable keyframes share one byte store and canonical retention entry point with
[direct image reads](image-read-and-retention.md). Existing `computer://`
references and their physical root remain unchanged. The media resolver owns
membership authorization without a preceding product detail load.

# Contract

Safe results return target identity, execution location, summary and safety. Semantic observations and script operations omit images unless explicitly requested.

Unit or fixture results alone must not be presented as complete product qualification.

# Boundaries

The media viewer does not authorize target actions, own lifecycle state, or expose private takeover pixels to model history.

Env App and Desktop share the pure path encoder; each host retains its existing authenticated transport and byte validation.

# Evidence

- `redeven:internal/ai/computer_live_frames.go` - bounded observer-owned samples.

- `redeven:internal/ai/computer_media.go` - host keyframe storage and validation.

- `redeven:internal/flower_ui/host/computerFramePath.ts` - host-owned media route encoding without transport or authorization.

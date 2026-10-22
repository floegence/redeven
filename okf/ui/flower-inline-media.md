---
type: UI Contract
title: Flower inline media
description: Display assistant media through released Floe previews and authorized Runtime resources.
tags: [flower, media, preview, security]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower displays assistant images, screenshots, video, audio, and self-contained
HTML directly in the conversation. Released Floe chat components own media
presentation and HTML isolation. Redeven owns resource routing and permission
checks; Floret's canonical message remains the only durable display source.
Unavailable, forbidden, oversized, or mismatched resources show a retryable
preview error without interrupting the conversation.

# Contract

## Authoring and interaction
- `![Title](source)` displays image, video, or audio. Preview references always produce inert placeholders. Health snapshots, labels, and ordinary thread updates do not reload a ready preview; a real context change cancels stale work.
- An `html preview` code fence previews an HTML fragment or document. A plain `html` fence previews when its content starts with a complete HTML document (`<!doctype html>` and `<html>`); standalone HTML snippets remain visible as source.

## Request lifecycle and thread ownership
One media entry at each rendered thread boundary serves both assistant Markdown and Activity images. A child without a trusted working directory cannot resolve relative sources or HTML links against the parent's directory.

Window close and Escape return focus only from the closing window to its connected trigger, preserving navigation and composer focus.

## Resource and document boundaries
The existing `/api/fs/file` route accepts `preview=1` for bounded chat previews.

Presentation creates no second message store, lifecycle, or Floret API.

# Boundaries

Canonical Floret messages remain the durable display source. Unavailable, forbidden, oversized or mismatched media stays an explicit preview error without interrupting the conversation.

# Evidence

- [Isolated Electron acceptance for Welcome and built Env App](../../desktop/scripts/check-flower-media.mjs): build Env App, then run `pnpm --dir desktop test:flower-media`; records both 30-second observations under `desktop/dist/flower-media-acceptance`.

- [Markdown integration](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)

- [Resource mapping](../../internal/flower_ui/src/chat/markdown/flowerMarkdownMedia.ts)

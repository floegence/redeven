---
type: UI Contract
title: Flower inline media
description: Display assistant media through released Floe previews and authorized Runtime resources.
tags: [flower, media, preview, security]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Assistant images, screenshots, video, audio and self-contained HTML render in shared Flower through released Floe media/HTML isolation. Redeven authorizes resource routing; canonical Floret messages remain the display source. Unavailable, forbidden, oversized or mismatched resources show local retryable errors without interrupting the conversation.

# Contract

## Authoring and interaction
`![Title](source)` displays image/video/audio; preview references are inert placeholders. Ordinary updates/health/labels do not reload ready media; real context changes cancel stale work. An `html preview` fence renders fragments/documents; plain `html` renders only a complete document beginning with doctype and html, leaving snippets as source.

Ready HTML exposes direct authorized file/floating expansion plus source/more in a compact top row. Until ready, expansion is disabled; controls/insets cannot cover content.

## Request lifecycle and thread ownership
One entry per rendered thread serves Markdown/Activity images. Children without trusted working directory cannot resolve against their parent's directory. Close/Escape restores only closing-window focus to a connected trigger, preserving navigation/composer focus.

## Resource and document boundaries
`/api/fs/file?preview=1` supplies bounded chat previews; presentation adds no durable message/lifecycle or Floret API.

# Boundaries

Canonical Floret messages remain the durable display source. Unavailable, forbidden, oversized or mismatched media stays an explicit preview error without interrupting the conversation.

# Evidence

- [Inline media browser acceptance](../../internal/envapp/ui_src/src/ui/FlowerSurface.richMedia.browser.test.tsx): direct floating and file preview actions, focus restoration, retained inline state, and content geometry at desktop and narrow widths.

- [Markdown integration](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)

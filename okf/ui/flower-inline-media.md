---
type: UI Contract
title: Flower inline media
description: Display assistant media through released Floe previews and authorized Runtime resources.
tags: [flower, media, preview, security]
timestamp: 2026-09-20T00:00:00Z
---

# Summary

Flower displays assistant images, screenshots, video, audio, and self-contained
HTML directly in the conversation. Released Floe chat components own media
presentation and HTML isolation. Redeven owns resource routing and permission
checks; Floret's canonical message remains the only durable display source.
Unavailable, forbidden, oversized, or mismatched resources show a retryable
preview error without interrupting the conversation.

# Authoring and interaction

- `![Title](source)` displays image, video, or audio. Ordinary HTTP(S) links stay
  navigable. Links whose filename identifies media or HTML display inline media.
- Local sources use absolute Runtime paths; relative paths resolve against the
  selected thread's working directory. Local files always cross the authenticated
  filesystem scope. They are never interpreted as application routes.
- A screenshot uses the exact `computer://target/digest` reference returned by
  the tool. Loading uses the existing thread-authorized computer frame adapter.
- An `html preview` fence or a local `.html` / `.htm` link renders an interactive
  preview. Ordinary `html` fences remain copyable source code. Raw HTML remains
  escaped. External HTML pages must be saved locally before inline preview.
- Media displays without outer cards or title bars, with a single rounded edge,
  quiet captions, and named actions on hover or keyboard focus (always
  visible on touch). Loading and retry states use the active locale.
  Clicking a local image or its eye button opens the existing host file preview
  with the same-file reuse policy. The folder button opens its containing
  directory through the host file browser. Remote images, opaque computer frames,
  and hosts without file navigation use Floe's shared floating preview; they do
  not expose a fabricated folder action or a raw blob link. Labels follow the
  active locale. Video/audio use native playback controls without autoplay.
  HTML expands without recreating its iframe.
- Only stable Markdown segments mount media. An unfinished streaming tail stays
  inert, and later reply text does not reload committed previews. Media near the
  viewport loads lazily. Disposal aborts pending observation and revokes blob URLs.

# Resource and document boundaries

The existing `/api/fs/file` route accepts `preview=1` for bounded chat previews.
Media is limited to 64 MiB; HTML is limited to 1,000,000 bytes and served only as
`text/plain; charset=utf-8` with `nosniff`. Ordinary HTML serving remains rejected.
Existing read permission, filesystem roots, symlink policy, and media range
behavior remain authoritative. Desktop admits only the closed GET route with one
path and the preview flag; its HTTP reader enforces the media byte bound before
IPC delivery. No credentials are exposed to the renderer.

Floe renders HTML in an opaque `allow-scripts` sandbox with a leading CSP. Inline
styles/scripts and embedded data images work; shell/storage access, network
fetches, external scripts, frames, and forms do not. HTML bytes are never mounted
in the trusted shell. HTML previews are self-contained and do not resolve sibling
assets. Existing local SVG serving remains unavailable.

Only assistant Markdown opts into resource resolution. Fetched web content and
user messages cannot use this adapter to read local files. Presentation creates
no second message store, lifecycle, or Floret API.

# Evidence

- [Markdown integration](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)
- [Resource mapping](../../internal/flower_ui/src/chat/markdown/flowerMarkdownMedia.ts)
- [Runtime preview checks](../../internal/codeapp/appserver/server_fs_file_test.go)
- [Desktop transport](../../desktop/src/main/runtimeFlowerHTTP.ts)
- [Conversation browser acceptance](../../internal/envapp/ui_src/src/ui/FlowerSurface.richMedia.browser.test.tsx)
- [Streaming ownership](flower-streaming-stability.md)
- [Computer media authority](../ai/computer-use-media.md)

---
type: Architecture Contract
title: Remote browser transport and media
description: Carry source DOM and element media through bounded authenticated lanes.
tags: [architecture, browser, transport, media]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

- Authority: the Runtime authorizes view carriers; FloeBrowser owns element capture, media identities, encoding feedback and client decoding.
- Outcome: clients receive source DOM, resources and element media through Flowersec without directly contacting websites or source media ports.
- Invariants: viewing, input and media subscriptions are separate; source tracks remain website-owned; bounded media credit includes partial frames; clients never establish WebRTC.
- Failure boundary: retired source/subscription identities are rejected, media loss stays scoped to its lane, and navigation never revives stale media or input.

# Authenticated lanes

DOM, resources, files and media travel through the authenticated transport. The client never fetches the source site or opens a raw CDP/media port. Background audio may continue under an explicit viewing subscription; hidden video picture delivery can pause without changing website playback. Flow control remains bounded per lane so media backlog cannot block tab selection or input.

Media carrier credit counts cumulative bytes consumed by the bounded packet
reader, including partial frames. Completed frames still await child-window
consumption before returning their final chunk credit. The upstream 64 KiB
outstanding-byte window applies inside a large Canvas or video frame; frame-count
credit must not let that frame fill the shared reliable connection ahead of input.
Browser protocol 22 explicitly negotiates this acknowledgement contract. The
source-local encoded-media wire remains version 1.


Source and view admission follows [browser source ownership](remote-browser-sources.md). Original uploads and downloads follow [browser files](remote-browser-files.md).

# Element capture ownership

Websites execute and play media at the source. The upstream collector accepts
only source-host loopback WebRTC and emits encoded element frames through the
Runtime's authorized media lane. It has no STUN/TURN configuration. The client
uses WebCodecs and AudioWorklet; it receives no source media endpoint.

A video or audio element backed by an existing `srcObject` stream is observed
through that stream with owned track clones. It is not recaptured: Chromium can
replace an original Canvas track wrapper and stop its producer after collection.
Closing observation stops only owned tracks, preserving website playback even
after garbage collection. Other media elements use native element capture.

DOM checkpoints preserve valid streams. Navigation, element removal and revoked
viewing retire corresponding streams and decoders. Hidden video picture delivery
may pause while authorized background audio remains active. Playback commands act
on the source element and admission never starts playback. Returned video requests
a fresh keyframe and does not replay queued old pictures.

# Evidence

- `redeven:internal/ai/computer_browser_streams.go` - Authorized DOM, input, media and file lanes.
- `redeven:internal/envapp/ui_src/src/ui/services/browserTransport.ts` - Borrowed Flowersec Session and progressive byte acknowledgements.
- `redeven:internal/codeapp/appserver/browser_projection_test.go` - Real Runtime and source-site-blocked product transport.
- `floebrowser:src/host/media-source.ts` - Owned capture tracks and picture subscriptions.
- `floebrowser:src/host/media-carrier.ts` - Bounded lane scheduling and cumulative byte credit.
- `floebrowser:test/media-source-lifetime.e2e.ts` - Source playback survives collection and observation disposal.
- `floebrowser:src/viewer/media.ts` - Identity-fenced decoding and element composition.

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

The released source adapter owns native file-capture audio and its generated
projection track. It cancels both stream endpoints on retirement or failure;
website-owned stream audio bypasses this adapter. Native helper diagnostics must
never enter its structured reply pipe, including RTCP interceptor shutdown logs.
Library loggers share the collector's silent logger.

Source Chromium negotiates RTP absolute capture time. The loopback collector
applies capture timestamps and optional clock offsets in complete-sample order,
so device-clock changes take effect without waiting for periodic sender reports.
Omitted extensions interpolate from the last capture mapping and RTP sample rate;
reports never overwrite a negotiated capture clock. Standard RTP senders without
the extension establish their mapping through an immediate sender report and
retain initial packets in the bounded receiver, including an isolated paused
picture. Audio and video must not invent separate clocks from packet arrival.

DOM checkpoints preserve valid streams. Navigation, element removal and revoked
viewing retire corresponding streams and decoders. Hidden video picture delivery
may pause while authorized background audio remains active. Playback commands act
on the source element and admission never starts playback. Returned video requests
a fresh keyframe and does not replay queued old pictures.

# Presentation timing

The upstream collector maps audio and video RTP clocks onto one source timeline.
Client decoding and presentation preserve their relative timestamps even if the
first video frame arrives late. Neither track is rebased to its first arrival.
The shared clock is anchored before synchronous audio-device initialization, so
startup cannot shift later video deadlines. Audio scheduling accounts for the
output device clock after the worklet has consumed its first samples.
Device-clock queries must not block audio startup;
video presentation retains its deadline while other tracks update.

Opus output retains the timestamp of each corresponding source packet, including
gaps and later clock corrections. A decoder's inferred continuous sample timeline
must not replace that authority. At most twelve pending packet timestamps are
retained, and decoder failure clears them.

Audio lookahead must fit the existing 12,000-frame PCM budget at 48 kHz. The
shared clock accounts for device presentation latency, the current block size,
and the 50 ms dispatch margin before admitting future audio. An older retained
picture cannot extend audio waiting beyond that capacity and cause normal pulses
to be dropped. The decoder and output worklet keep the same hard bound.

File-backed Chromium capture timestamps upcoming audio behind the native output
device delay. The upstream adapter estimates this delay from a bounded lower
delivery-age envelope and restores presentation timestamps before encoding,
without changing PCM, source routing, playback rate, volume or mute. Already
future-dated audio receives no correction. This is an estimate rather than a
native device-latency API; old measurements expire after 32 input blocks.

Decoded video lends at most six pictures to the presentation queue and retains
only one additional latest picture under backpressure. One animation callback
preserves future deadlines and consumes obsolete due pictures without replaying
them. Selection clears queued pictures and rejects old decoder generations.
The presentation canvas captures changed pictures without a second frame-rate
timer; source encoding and the bounded presentation queue already limit delivery.
Identical retransmitted Canvas pixels reuse their existing decoded resource;
changed pixels and dimensions still update.
Canvas hover, focus and style mutations preserve the media-owned image and
intrinsic dimensions. Placeholders belong only to new projected nodes; input
feedback cannot replace delivered graphics or reset their size. Real-site
qualification compares the largest visible Canvas with the same source scene
before and after interaction, including the TSL preview rather than an editor
scrollbar. A decoded placeholder alone is not visual acceptance evidence.
Main-thread WebGPU canvases use the same bounded element-image path as Canvas
2D and WebGL. Native texture acquisition and queue submission update the current
source-local bitmap before presentation discards it, without recording commands,
changing rendering options or executing website code in the viewer. Worker-owned
OffscreenCanvas and protected or origin-tainted graphics remain unsupported.

Normal-media acceptance compares visible flashes with audible pulses at the
audio device timeline and requires at most 100 ms of skew. The source fixture
must contain simultaneous pulses. Decoder callback timing alone does not prove
presentation synchronization. Stable Firefox uses native WebDriver to run the
same audible/presented measurement as Chrome and Desktop. Comparison-window
edges must retain both halves of each measured pulse. Local overlays provide
debugging evidence only; release acceptance uses the published dependency and
built product assets.

# Evidence

- `redeven:internal/ai/computer_browser_streams.go` - Authorized DOM, input, media and file lanes.
- `redeven:internal/envapp/ui_src/src/ui/services/browserTransport.ts` - Borrowed Flowersec Session and progressive byte acknowledgements.
- `redeven:internal/codeapp/appserver/browser_projection_test.go` - Real Runtime and source-site-blocked product transport.
- `floebrowser:src/host/media-source.ts` - Owned capture tracks and picture subscriptions.
- `floebrowser:src/host/media-audio.ts` - Bounded native audio timestamp correction and owned endpoint disposal.
- `floebrowser:src/host/media-carrier.ts` - Bounded lane scheduling and cumulative byte credit.
- `floebrowser:test/media-source-lifetime.e2e.ts` - Source playback survives collection and observation disposal.
- `floebrowser:src/viewer/media.ts` - Identity-fenced decoding and element composition.
- `floebrowser:test/media-presentation.e2e.ts` - Future picture deadlines, credit return and selection cleanup.
- `floebrowser:test/audio-timestamps.e2e.ts` - Opus packet gaps and source-clock corrections across decoder implementations.
- `floebrowser:test/media-sync.e2e.ts` - Displayed and audible pulse synchronization, including delayed initial video.
- `redeven:internal/envapp/ui_src/scripts/browserProjectionMediaSync.mjs` - Product presentation timing through Flowersec.
- `redeven:internal/envapp/ui_src/scripts/browserProjectionSites.mjs` - Same-source Canvas pixel comparisons and paired site screenshots after input.

---
type: Qualification Record
title: LAN codec and capture experiments
description: Check codec, rate, quantization and capture tradeoffs and retry evidence before changing the desktop media path.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
---
# Summary

The primary qualification task owns these media decisions. Historical VP9 and
hardware AV1 both exceeded the current three-round presented cadence. Codec
selection alone has not isolated the regression. Preserve screen-text quality,
ordered frames, current input/recovery behavior and explicit hardware evidence.
Temporary rate or capture variants remain diagnostic until repeated real-window
latency, quality and complete resource qualification passes. Restore released
settings after rejected experiments. The [decision index](remote-desktop-lan-experiment-ledger.md)
owns historical identities and the next controlled comparison.

# Conditions And Interpretation

Evidence root `B`, dates, common physical scene and acceptance are defined in the
[decision index](remote-desktop-lan-experiment-ledger.md). Unless a row supplies
an exact version/consumer, it is a temporary post-v42 or v45 diagnostic, with
exact overlay provenance in its preparation script, not a published release.
Unknown historical consumer identity is an explicit evidence gap. All quoted
latencies are input-to-observed-client-pixels, except explicitly isolated probes.
No short favorable sample replaces three valid pairs or equal delivered detail.

# Decision Ledger

| ID / variable and identity | Validity and result | Decision / tradeoff / retry criterion | Raw evidence under B |
| --- | --- | --- | --- |
| M01 / VP9 screen-text quantizer, native `0741ca9`, v0.22.41 | Add max-quantizer 48 after offline glyph-quality probe; no isolated paired regression proof | Adopt quality protection. Retry only with matched complete-v40/current comparison plus text detail and encode timing; do not silently discard quality | `av1-integration/v41-module-provenance.json`; native commit/tests |
| M02 / verified Intel VA-API AV1, `f86d542`, v0.22.42 | Private driver and positive client offer; lower host CPU. Real rounds range 35.39 to 50.53 FPS, with tails | Adopt capability, not a claim of stable parity or hardware client decode. Compare complete H42/H47 before blaming AV1 | `av1-integration/v42-module-provenance.json`, `published-v42-paired`; H42 in index |
| M03 / AV1 Smooth base 4M -> 3M, max QP 128 -> 160 | 100/100; 52.38 FPS, P95 138.89 ms, max 206.34 ms, gaps 0; one diagnostic | Unresolved: strong sample, quality/repeatability unqualified. Base rate scales by pixels. Retry only paired with current rate under same time/viewport and exact moving quality | `prepare-lan-rate-bound.py`, `lan-rate-bound-analysis.json` |
| M04 / intermediate base 3.5M/QP144 | 100/100; 35.49 FPS, P95 298.59 ms, gaps 3 | Rejected as established improvement. Retry only if C01/stage evidence isolates rate-induced stalls; another arbitrary midpoint is insufficient | `prepare-lan-balanced-bound.py`, `lan-balanced-bound-analysis.json` |
| M05 / force VP9 in current path | 100/100; 34.44 FPS, P95 406.78 ms, gaps 3 | Rejected as recovery evidence. Complete old implementation differs. Retry as a component isolation only after C01, preserving matching settings | `prepare-lan-vp9-selection.py`, `lan-vp9-selection-analysis.json` |
| M06 / VP9 max quantizer 63 | 100/100; P95 315.53 ms; panel peak about 57 FPS. Saved aggregate 28.56 FPS includes 14.2 s gap | Rejected as stable improvement. Keep timing context; cannot use peak or aggregate as clean codec benchmark. Retry needs bounded workload and text quality evidence | `prepare-lan-vp9-rate-admission.py`, `lan-vp9-rate-admission-analysis.json` |
| M07 / more efficient VP9 encode parameters | 99/100; 21.59 FPS, P95 500.74 ms, gaps 9 | Rejected. Offline compression efficiency did not predict real session. Retry needs a new measured bottleneck rather than another preset sweep | `prepare-vp9-efficient-rate.py`, `lan-vp9-efficient-rate-analysis.json` |
| M08 / submit cap 40 Hz | 100/100; 35.59 FPS, P95 288.79 ms, one gap | Rejected as tail fix. Retry only after evidence identifies enqueue oversupply at the same rate | `prepare-lan-submit-cadence.py`, `lan-submit-cadence40-analysis.json` |
| M09 / static DRM activity deadline, `fdc28b5`, v0.22.43 | Isolated unchanged-input worker: two 12 s trials, four frames each, CPU 61.988% -> 22.745%; valid moving pair still 48.82 FPS/P95 187.54 ms/four gaps | Adopt static CPU improvement; preserve immediate input wake and changing-pixel activity. Retry dynamic effect only with matched historical capture trace | `drm-cadence-native-analysis-retry1.json`; [v43 record](remote-desktop-rustdesk-v43-results.md) |
| M10 / direct converted output into shared completion buffer, `e400c37`, artifact refresh `99fa004`, v0.22.47 | Removes full-frame copy; complete H47 three-round comparison still fails tails and memory | Adopt copy removal, do not equate micro improvement with parity. Retry effect only by isolated buffer variable and identical artifact stack | `v47-paired`, published native diff and worker tests |
| M11 / compositor GPU budget 2048 -> 256 MiB, v42 diagnostic | 40/40 only; 48.39 FPS, P95 271.62 ms, four gaps; footprint 1090.84 MiB, tile-memory warnings | Rejected, restored 2048 MiB. No memory remedy shown. Retry needs allocation-owner evidence and full workload without warnings | `published-v42-paired/r2-redeven-motion-retry7`; [v42 record](remote-desktop-rustdesk-v42-results.md) |

# Preserved Functional Boundaries

v40-to-v47 native changes add positive AV1 negotiation, static-capture scheduling,
bounded asynchronous media writes, receipt coalescing and shared conversion output.
Consumer changes also include immediate default Host-key dispatch and transport
efficiency/security updates. A codec-only switch does not reverse all of them.
Keep current authorization, lock/unlock recovery, input lifecycle/cancellation,
generation/order checks and dependency security fixes. Any causal comparison of
old artifacts is isolated from the production upgrade decision.

# Evidence

- Native `git diff v0.22.40 v0.22.47`: `host_desktop_media.py`, `host_desktop_drm.py`, `host_desktop_player.mjs`, `host_desktop_wire.py` and `native/host-desktop/drm/worker.c`.
- B/`published-v40-paired/quality-calibrated-summary.json`: older text quality cannot simply be presumed worse; viewport/resampling limitations remain.
- B/`lan-capture-phase-stages.json`: existing capture/encode evidence must be checked before adding instrumentation.

---
type: Qualification Record
title: Published six-frame LAN qualification C05
description: Verify the released optional frame window against RustDesk and retain preparation failures separately from performance evidence.
tags: [desktop, performance, qualification]
timestamp: 2026-10-15T10:45:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The primary qualification task owns C05. The optional six-frame implementation
must use a published native module and preserve four-frame legacy/macOS behavior,
confirmed paint, generation/order fences and finite admission. C04 establishes a
diagnostic throughput benefit, not released recovery or full RustDesk parity.
The [comparison contract](remote-desktop-rustdesk-comparison-results.md) owns
acceptance. A failed release gate or invalid fixture stops qualification; retain
its evidence and repair the named failure before retrying.

# Contract

Read the [decision ledger](remote-desktop-lan-experiment-ledger.md), C01 historical crossover, C02 receipt rejection, C03/C04 window comparison and P03/P04 timing record before C05.

Use bounded 300-second motion samplers and two 50-click input batches to avoid the documented C04 timeout.

The Go proxy/checksum database resolves the immutable tag to the native commit above with module sum `h1:wlvpKFaGY5zYhA20QzUTXCfVEQvYpT5rj1bTivcn8VY=`. Its first attempt exposed a fixture-only capability refresh that omitted the selected window while the assertion retained six; preserve the failure and carry the same offer in unrelated capability refreshes. These checks establish compatibility behavior, not LAN performance acceptance.

# Boundaries

Release and compatibility checks establish only their named published contracts. The post-reboot fixture has a distinct boot identity; never join its intervals to earlier sampling. C05 outcomes retain adverse trials, source loss and resource/detail limitations.

# Evidence

- B/`published-v48-paired/release-attempt1`: original qualification artifacts.

- B/`window-c04/input-audit.json`: diagnostic evidence, separate from C05.

- [Decision ledger](remote-desktop-lan-experiment-ledger.md): compact adopted, rejected and unresolved experiment outcomes.

The immutable v0.22.48 tag's release qualification run is `38721381321`. Rebuild fixtures and record new process identities; do not join pre-reboot and post-reboot intervals or reuse stale credentials/geometry.

## Preparation Record
The immutable v0.22.48 tag's release qualification run is `38721381321`. Rebuild fixtures and record new process identities; do not join pre-reboot and post-reboot intervals or reuse stale credentials/geometry.

The Runtime is built from consumer commit `20bc99cb46938f3349555e9a91b5e66b1497bb0d` with published v0.22.48 and no overlay. No performance acceptance follows from C04's peak.

## Post-Reboot Fixture
The Runtime is built from consumer commit `20bc99cb46938f3349555e9a91b5e66b1497bb0d` with published v0.22.48 and no overlay. No performance acceptance follows from C04's peak.

[Complete C05 outcomes](remote-desktop-lan-c05-results.md) owns all three pairs, invalid fixtures, source loss, resources, detail and next experiment conditions. Keep the SHA-verified published v48 native service, not a diagnostic replacement.

## Outcome And Cleanup
[Complete C05 outcomes](remote-desktop-lan-c05-results.md) owns all three pairs, invalid fixtures, source loss, resources, detail and next experiment conditions. Keep the SHA-verified published v48 native service, not a diagnostic replacement.

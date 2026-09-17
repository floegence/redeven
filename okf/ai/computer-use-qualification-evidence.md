---
type: Verification Evidence
title: Computer use qualification evidence
description: Read measured browser and desktop outcomes without conflating adapter, model and final integration scopes.
tags: [ai, computer-use, testing, evidence]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

The production qualification runners establish scope-specific outcomes under
[the acceptance contract](computer-use-qualification.md). The following results
were observed on 2026-09-17. A passing worktree run does not replace the exact-main
pre-push gate, certify arbitrary applications, or turn earlier failed runs into
successes. Private text and pixels are excluded from retained diagnostics.

# Contract

Keep measurements bound to their declared platform, provider and source build.
Preserve failed runs as failed evidence and use the acceptance contract for
required effects, privacy and cleanup. Never infer cross-platform success from
one adapter or from a model request returning HTTP 200.

# Evidence

## Real model product flows

| Tested scope | Model requests | Decoded frames by turn | Distinct images by turn |
| --- | ---: | --- | --- |
| macOS native Desktop | 21 | 13 / 76 / 13 | 13 / 75 / 13 |
| Managed browser Desktop after private restart | 43 | 56 / 65 / 412 | 38 / 38 / 189 |
| Linux Webtop browser | Part of 82 total | 8 / 4 / 29 | 8 / 4 / 29 |
| Linux Webtop X11 | Part of 82 total | 18 / 54 | 18 / 54 |

Native Desktop confirms exact click counts of 2 then 4, canvas double-click,
text/Enter, wheel scrolling, canonical target references and final screenshots.
Incidental human input does not interrupt the sequence.

The latest managed-browser Desktop run uses source commit `da614fbcd4a4`.
Private takeover and Runtime restart run first; the complete real-model browser
flow then uses that same Runtime. Semantic and visual input, navigation, hidden
execution, Stage layout, settings, private ASCII/IME and safe handback pass.
Explicit Stop during dispatched navigation records an unknown outcome without
replay. Both cancellation paths support a new same-thread visual task.
Recovery and ordinary preparation reuse one managed profile owner. The matching
real Chromium regression verifies this owner and passive-sampling boundaries.

The complete Linux scope confirms private handback, cancellation, media
isolation, fork, Runtime restart and cleanup. Semantic target and requested-access
references survive the public Activity projection. No error frames or failed
public viewer/media responses were recorded. This does not qualify native macOS
or connected Chrome.

Task-owned Desktop/Runtime processes, ports and temporary state are removed
after the latest Desktop qualification; source configuration and credential
files remain byte-identical. The Linux runner separately verifies container and
port removal and unchanged source configuration.

## Native and private fixture results

After console unlock and explicit continuation, macOS background and foreground
fixtures pass. The background scope verifies AX labels, occluded target-only
pixels, excluded-owner filtering and unchanged foreground/pointer. The native
action scope verifies AX values/buttons, canvas double-click, Enter, scrolling
and restoration of the original application, window and pointer after each
operation. These fixtures do not establish universal AX background behavior.

The latest built Desktop private fixture passes ordinary/private preview, every
frame-rate choice, native IME, rejected and successful handback, single
navigation, narrow layout and preference persistence. Delayed private pixels
are decoded in 386ms. Restart resets the current view revision from 28 to 1,
requires explicit recovery, preserves terminal collapse and supports deliberate
historical viewing without live input controls.

Earlier startup, scroll-region, input-pause and profile-owner failures remain
failed historical evidence. The private fixture alone did not prove that a
later ordinary model task could reuse the browser; the combined run above
closes that regression. Lock-screen operation remains unsupported.

## Performance scope

[Paired measurements](computer-use-performance.md) own the complete benchmark
series, thresholds and measurement limits. The latest managed headless browser
pair meets all three efficiency thresholds with equal 9/9 success. These
measurements do not establish native desktop or Chrome extension performance.

# Boundaries

The source runners, not these aggregate counts, define pass/fail invariants.
Changed frame-rate preferences and task durations affect frame counts; counts
cannot be compared as a performance benchmark. The exact-main integration gate
separately covers packaged resources and the integrated source.

Representative runners are `redeven:internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs`,
`redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` and
`redeven:scripts/check_computer_use_webtop.sh`. See the acceptance contract for
cleanup, evidence binding and scope restrictions.

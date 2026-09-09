---
type: Runtime Contract
title: Managed Service operation progress
description: Persist and stream bounded, redacted lifecycle command output while preserving stable, user-controlled progress presentation.
tags: [architecture, managed-services, operations, observability, security, ui]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

- Authority: a Manager-owned Reporter publishes each active operation; the Registry owns durable history.
- Outcome: users can inspect bounded lifecycle output and keep a brief completion visible while list and stream refreshes preserve the expanded row.
- Invariants: safe command templates, pre-persistence redaction, one operation ID for disclosure, readable terminal feedback, and no Runtime identity derived from output.
- Failure boundary: persistence, streaming, capture, and validation failures never expose raw output, secrets, credentials, sensitive URL queries, private paths, or control characters.

# Contract

## Reporter and persisted detail

`ManagedOperationProgressDetail` schema v2 is the sole progress document. It retains stage timing and structured transfer facts, then adds ordered commands and output lines. A command has a stable operation-local ID, safe display template, state, and start and finish times. An output line has a monotonic sequence, owning command ID, `stdout` or `stderr` source, and redacted text. Duplicate proposed command IDs receive deterministic suffixes so output cannot become ambiguous.

The concurrent Reporter owns every mutation to an in-flight progress document. Host, Container, and Compose continue to report the facts they genuinely possess: npm install, npm rebuild, and Host installation/maintenance hooks stream redacted output; private after-start/open hooks never stream their results; image pulling retains structured layer and byte progress when no command stream exists. Ordinary output is persisted and broadcast no more often than every 500 milliseconds and no later than 500 milliseconds after a quiet burst. Command transitions, stage transitions, failure, cancellation, completion, and Reporter close flush immediately. Terminal state is written only after the Reporter closes, so delayed output cannot overwrite completion.

The retained tail is at most 400 lines and 128 KiB, with at most 4 KiB per line and at most 64 commands. ANSI sequences and unsafe control characters are removed. Known Secret values, authorization fields, credential-shaped values, sensitive URL query values, the Manager state root, and the service workspace are replaced before any persistence, event publication, or service-log write. A truncation fact tells the UI that older content was removed; it does not reconstruct discarded output.

Uninstall keeps operation metadata, command templates, state, timing, error code, and retry lineage for audit, but clears output text for every operation owned by that service in the same transaction that finalizes uninstall. Failed uninstall retains current records and output; the [management review](service-management-recovery.md) presents completed and pending resources before a new confirmed continuation.

## Service-row interaction

The owning page stores explicit expanded or collapsed state by `operation_id`; row component identity and service-object identity are not state owners. The service list is keyed by stable `service_id`, so refreshed service snapshots update the existing row and disclosure DOM in place instead of replaying entry presentation. The submitting placeholder shows request-submission feedback and transfers its explicit state once to the accepted backend operation ID. A rejected submission retains its safe failure in the same renderer disclosure; it creates no durable backend operation and does not change the observed service state. Failure explanations remain readable below the operation heading. SSE snapshots and service-list replacements update the existing disclosure in place. A later operation defaults collapsed, and an operation removed from both page state and service state releases its disclosure entry.

The details surface keeps the ordered stage list on the left and one stage-context panel on the right at wide widths, then stacks those regions on narrow screens. That right panel uses the facts available for the current operation step: image or package transfer progress during transfer work, command templates and their bounded live output during command work, and stage timing when neither richer context exists. Command output never becomes a separate full-width region below both columns. The output viewport is the only local scroll owner. It follows new output while the user remains at the bottom, stops following when the user scrolls upward, and resumes only after the user returns to the bottom. Output changes do not open the disclosure, move page focus, or create a dialog.

Every operation request path, including reviewed management actions, releases its controller tracking in a `finally` block. Closing a drawer does not release tracking by itself. Release lets the presentation controller settle successful results and preserves attention results; it does not remove durable history. A stream failure must also release the local tracking so inspection remains available.

One Renderer presentation controller separates operation visibility from backend activity. A successful operation remains visible until both a 1.8-second minimum lifetime and a 1.2-second completed-state hold have elapsed, then exits through a 220-millisecond height, opacity, and position transition before unmounting. A transient submission released before backend acceptance still observes the minimum lifetime. An explicitly expanded transient or successful operation does not auto-close while the user is reading it; collapsing it resumes the settled exit. Failed, cancelled, and interrupted results remain available until a later operation replaces them or the owning service leaves the list. Retained terminal presentation never keeps service actions busy, and a later operation replaces the retained result immediately. Reduced-motion preference removes the animation without shortening the readable hold.

# Boundaries

Operation output is observability data, not a terminal, shell, downloadable transcript, or raw debug channel. Renderer cannot request an unredacted variant. The Reporter does not invent percentages, byte totals, image commands, or missing process output. Application output used for dynamic opening goes directly to a private file. Template hooks parse it, and the generic URL validator keeps their result outside this progress document.

# Evidence

- `redeven:internal/managedwebservice/operation_progress.go` - Owns concurrent mutation, throttled persistence, limits, sequencing, and redaction.
- `redeven:internal/managedwebservice/npm_host.go` - Streams real npm install and rebuild output through the Reporter.
- `redeven:internal/managedwebservice/custom_host.go` - Streams Host lifecycle output through one collector and closes commands with their actual result.
- `redeven:internal/portforward/registry/managed.go` - Canonicalizes progress v2 and clears service output bodies during uninstall finalization.
- `redeven:internal/portforward/registry/schema.go` - Verifies the canonical progress document inside the permanent Registry lineage.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns operation-ID disclosure state and the bounded bottom-follow output viewport.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceOperationPresentation.ts` - Owns minimum visibility, terminal retention, expansion-aware exit, and presentation replacement.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceOperationPresentation.test.ts` - Verifies brief success timing, expanded-detail retention, attention states, and replacement.
- `redeven:internal/managedwebservice/operation_progress_test.go` - Covers ordering, bounds, redaction, quiet-burst persistence, and close behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Verifies stable output DOM, truncation, stream semantics, and user-controlled following in a real browser.

- `redeven:internal/envapp/ui_src/src/ui/pages/WebServicesPage.browser.test.tsx` - Verifies recovery completion exits while the service row survives, expanded reading, retained failures, and review after stream disconnection.

---
type: Runtime Contract
title: Managed Service operation progress
description: Persist and stream bounded, redacted lifecycle command output while preserving user-controlled detail state.
tags: [architecture, managed-services, operations, observability, security, ui]
timestamp: 2026-09-03T00:00:00Z
---
# Summary

- Authority: one Manager-owned Reporter mutates, persists, and publishes each active Managed Service operation; the Registry is the durable operation-history authority.
- Outcome: users can keep an operation expanded through list and stream refreshes and inspect real, safely bounded lifecycle output while work is running.
- Invariants: command displays are safe templates, output is redacted before persistence or broadcast, one operation ID owns disclosure state, and output never becomes a source of Runtime identity or application behavior.
- Failure boundary: persistence, stream, capture, or validation failures cannot expose raw output, secrets, authentication data, sensitive URL queries, managed private paths, or control characters.

# Contract

## Reporter and persisted detail

`ManagedOperationProgressDetail` schema v2 is the sole progress document. It retains stage timing and structured transfer facts, then adds ordered commands and output lines. A command has a stable operation-local ID, safe display template, state, and start and finish times. An output line has a monotonic sequence, owning command ID, `stdout` or `stderr` source, and redacted text. Duplicate proposed command IDs receive deterministic suffixes so output cannot become ambiguous.

The concurrent Reporter owns every mutation to an in-flight progress document. Host, Container, and Compose continue to report the facts they genuinely possess: npm install, npm rebuild, and Host Hooks stream command output; image pulling retains structured layer and byte progress when no command stream exists. Ordinary output is persisted and broadcast no more often than every 500 milliseconds and no later than 500 milliseconds after a quiet burst. Command transitions, stage transitions, failure, cancellation, completion, and Reporter close flush immediately. Terminal state is written only after the Reporter closes, so delayed output cannot overwrite completion.

The retained tail is at most 400 lines and 128 KiB, with at most 4 KiB per line and at most 64 commands. ANSI sequences and unsafe control characters are removed. Known Secret values, authorization fields, credential-shaped values, sensitive URL query values, the Manager state root, and the service workspace are replaced before any persistence, event publication, or service-log write. A truncation fact tells the UI that older content was removed; it does not reconstruct discarded output.

Uninstall keeps operation metadata, command templates, state, timing, error code, and retry lineage for audit, but clears output text for every operation owned by that service in the same transaction that finalizes uninstall. Failed uninstall retains the current records and output so explicit retry has the same observable context.

## Service-row interaction

The owning page stores explicit expanded or collapsed state by `operation_id`; row component identity and service-object identity are not state owners. The submitting placeholder transfers its explicit state once to the accepted backend operation ID. SSE snapshots and service-list replacements update the existing disclosure in place. A later operation defaults collapsed, and an operation removed from both page state and service state releases its disclosure entry.

The details surface shows stages, transfer facts, command templates, stream semantics, live tail, and truncation state inline below the service row. The output viewport is the only local scroll owner. It follows new output while the user remains at the bottom, stops following when the user scrolls upward, and resumes only after the user returns to the bottom. Output changes do not open the disclosure, move page focus, or create a dialog.

# Boundaries

Operation output is observability data, not a terminal, shell, downloadable transcript, or raw debug channel. Renderer cannot request an unredacted variant. The Reporter does not invent percentages, byte totals, image commands, or missing process output. Dynamic Host opening observes the original startup line before redaction only inside the Runtime validator; its private query never enters this progress document.

# Evidence

- `redeven:internal/managedwebservice/operation_progress.go` - Owns concurrent mutation, throttled persistence, limits, sequencing, and redaction.
- `redeven:internal/managedwebservice/npm_host.go` - Streams real npm install and rebuild output through the Reporter.
- `redeven:internal/managedwebservice/custom_host.go` - Streams Host lifecycle output through one collector and closes commands with their actual result.
- `redeven:internal/portforward/registry/managed.go` - Canonicalizes progress v2 and clears service output bodies during uninstall finalization.
- `redeven:internal/portforward/registry/schema.go` - Migrates progress v1 to v2 atomically in Registry v5.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns operation-ID disclosure state and the bounded bottom-follow output viewport.
- `redeven:internal/managedwebservice/operation_progress_test.go` - Covers ordering, bounds, redaction, quiet-burst persistence, and close behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Verifies stable output DOM, truncation, stream semantics, and user-controlled following in a real browser.

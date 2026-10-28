---
type: Verification Evidence
title: Media contention and native read qualification
description: Distinguish deterministic contract checks, real DeepSeek task outcomes and evidence-parser defects for media and tree reads.
tags: [ai, computer-use, testing, media, accessibility]
timestamp: 2026-10-28T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-28"
---
# Summary

The October 28 qualification validates cancellable media-write admission and
native node/subtree completeness. Production uses published Floret v7.88.0;
its existing cancellable inventory and write-gate contract need no upstream
change. Browser, AX and AT-SPI share the same completeness semantics.

# Contract

[Media retention](image-read-and-retention.md) keeps the write gate until a
cancelled maintenance scan has settled. A partial inventory cannot authorize
deletion. [Semantic reads](computer-use-semantics.md) disclose omitted children;
read failures cannot become empty leaves. The shared core guide clarifies one
node versus a subtree or loaded collection. The three default tool definitions
and base system prompt are unchanged. No application-specific recovery, automatic
input replay or alternative parameter signatures were added.

# Evidence

Before the fix, deterministic tests reproduce a maintenance-blocked write, a
cancelled writer that cannot return, and missing native truncation flags. The
final focused media race suite, complete ai package, go vet, 19 browser/QuickJS
checks, 37 Swift tests and isolated Linux GTK/AT-SPI/X11 qualification pass.
Serial macOS qualification confirms node/subtree/leaf facts, scroll events,
capture and focus/pointer restoration. Commit continuity checks pass 239 state
tests and 374 client tests.

Configured local DeepSeek V4.1 Flash (1017), wire deepseek-flash, runs through the
production Service and isolated Chromium/AppKit fixtures. The original 12 cases
repeated three times yield 31/36 strict assertion passes, 248 provider requests,
217 tool activities and 35 error activities including intentional diagnostics.
Media contention passes 3/3: the scan cancels, screenshots finish and each save
occurs exactly once. All three tasks contain separately reported model script
errors; contract success does not imply error-free execution.

The five original failures remain retained: two multi-page tasks do not perform
two transitions in one script; one content-wait task uses wrong arguments and an
absent value() method; one native result is correct but labelled JSON is missed
by the test parser; one browser scope task combines that parser issue with an
unsupported snapshot option. Only the test parser changes: it accepts a complete
JSON object/array after an optional label and rejects partial JSON, prose and
trailing commentary. It does not repair production responses.

Six supplemental scope tasks yield 4/6 strict passes, 39 requests, 33 activities
and two errors. All six confirm container and limited-subtree truncation; all
three browser cases confirm complete rows. One browser case fails its unchanged
zero-script-error assertion. One native case filters on absent canonical_role,
does not read/log a complete leaf, and correctly fails that requirement. Exact
native text, one click and screenshots are confirmed in all three native cases.
No further reruns replace those failures.

Earlier environment/pilot failures and native focus/capture transients remain
external evidence. One initial full-ai run hits an unrelated three-second
history deadline; the focused test passes three repeats and the complete package
passes with bounded parallelism. Missing Desktop dependencies initially prevent
the commit gate; a frozen-lockfile installation resolves that prerequisite.

# Boundaries

Configuration and credential-file hashes remain unchanged. Production source
hashes match between the 36-case run and supplemental run; only the test parser
changes. No real user thread is continued. Reports retain raw failures outside
Git. The configured wire alias is verified, not the remote model weights.
These observations do not establish universal model success or certify arbitrary
applications. Linux uses deterministic native fixtures, not a real-model run.
The user explicitly excludes Redeven push and its push gate; local feature
qualification does not claim remote CI or exact-main push certification.

# Related Concepts

- [Qualification contract](computer-use-qualification.md)
- [Earlier qualification evidence](computer-use-qualification-evidence.md)
- [Script execution contract](computer-use-scripts.md)

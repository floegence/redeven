---
type: Verification Evidence
title: Media contention and native read qualification
tags: [ai, computer-use, testing, media, accessibility]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
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

Red fixtures reproduce maintenance-blocked writes, cancellation that cannot return and missing truncation flags. Green:media race, full ai, vet,19 browser/QuickJS,37 Swift, isolated Linux GTK/AT-SPI/X11; serial macOS confirms node/subtree/leaf, scroll, capture, focus/pointer restoration. Commit continuity:239 state/374 client passes.

Configured DeepSeek V4.1 Flash 1017 (deepseek-flash) uses production Service/isolated Chromium/AppKit. Twelve×3=31/36 strict passes,248 requests,217 activities,35 errors including negatives. Contention 3/3 cancels scans/completes screenshots/saves once; each has separately reported model errors.

Retain five failures:two multipage tasks omit two transitions in one script; content-wait uses wrong args/absent value(); native label-JSON parser misses correct result; browser scope combines parser defect with unsupported snapshot option. Only parser accepts complete object/array after optional label; reject partial JSON/prose/trailing commentary, never repair product output.

Six supplements 4/6,39 requests/33 activities/two errors. All confirm container/subtree truncation, browser 3/3 complete rows. One browser violates zero-error assertion; one native filters absent canonical_role/omits complete leaf. Native exact text/one click/screenshots 3/3. No reruns erase failures.

Pilot/environment/native-focus transients remain external. Initial full ai hits unrelated three-second history deadline; focused×3 and bounded-parallel full package pass. Frozen Desktop dependencies resolve an initial commit-gate prerequisite failure.

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

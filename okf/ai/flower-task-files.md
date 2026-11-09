---
type: AI Runtime Contract
title: Flower working files and deliverables
tags: [flower, files, tools, storage, permissions]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Intermediates belong to Runtime state; finals to requested destination. Private roots grant no sibling authority. [Filesystem policy](tool-permission-runtime.md) governs all tools; cwd resolves paths only. Publish settings/validated canonical upload claims transactionally under source-deletion gate.

# Contract

## Placement and authority
Runtime owns StateDir/task-files/ThreadID/{scratch,staging}; finals use user's destination/project/worktree, independent of temporary cwd. Admission/provider context share absolute roots. System placement overrides skills without filename heuristics/new grants; ordinary source/test/build locations remain. Children receive FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, never FLOWER_OUTPUT_DIR; cwd/HOME/cache/TMPDIR retain semantics. Reject escaping links/siblings without whitelisting authorized external roots.

## Fork and recovery
Fork copies current scratch/staging even at historical cut, not historical snapshots; project/finals stay shared. Block source admissions/cleanup, cancellably drain admitted work, reject unreaped processes. Rooted bounded copy preserves executable bits, checks identity/size/time/final tree, rejects external/hard links/unsupported types and renames complete private staging only.

Unadmitted copies remain invisible; canonical replay finishes publication without recopying admitted edits. Source markers survive cleanup until deletion and support interrupted context/publication. Recheck ownership before removing failed copies. Startup/periodic scans50names/batch, skips in-flight and removes private stages/marked forks without settings. Orphan actions share target gate. Retry preserves canonical identity with fresh copy. Context maps nested ancestor suffixes; inspect/repair hardcoded paths without rewriting history. Ancestor cleanup never deletes descendants.

## Delivery and discovery
file_present cancellably validates/hashes authorized regular files outside app state with identity/size/mtime checks; returns path/title/MIME/size/SHA256/mtime/endpoint/thread/turn/run without moving original. Files discovers canonical authorized successful results (50records/page,32KiB/record), retaining restart/Fork provenance without crawling/ledger. Availability checks unchanged size/mtime, no historical rehash; missing/changed/unavailable are observations.

Default deliveries/uploads; Process files separates tool images/temporary files without retention change. One controller advances50item/128byte-preview windows through empty/search pages until cursor end; viewport end drives reads. Initial sources may parallelize, then serialize. Repeated cursor offers Retry; temporary/child preview pauses discovery, no fullView/retention scans. Equal same-owner refresh preserves successful rows/focus/scroll. Scope change invalidates; close/change aborts discovery/preview/download reads and fences replies. Partial failure retains successes. Floe Dialog owns bounds/Tab/Escape/restoration; close retains query/filter/scroll, folder handoff closes. Env has rich renderers; Desktop image/PDF/text/Markdown/opaqueHTML, otherwise Download.

loadTaskFile validates endpoint and reauthorizes every256KiB, rejects version/offset drift, caps preview20MiB and streams downloads. Desktop permits exact thread endpoint/query keys with IPC cancel. Blob sinks retain memory costs; reads never publish original.

## Downloads and panel
Enqueue in Shell Downloads before destination: one Env topbar/Desktop full-companion owner. Deliveries/temporary use validated chunks; uploads/images use attachment reader. Retry binds original source/thread/runtime; metadata contains no URL/Blob. Manager owns destination/progress/cancel/failure/retry/completion. Thread/list changes stop previews, not admitted downloads; reopened lists check active downloads before cleanup. Late settlement cannot revive cancellation; finalization cannot cancel. Native destination offers Reveal/Open, browser handoff stays explicit. Retain until Shell exit/Clear finished, never import OS history.

Published controls/icons/tokens: title/close header, search/refresh body, filters only multiple known kinds, removed choice resets All. No ambiguous totals/empty headings/collapsed images/manual paging. Delivered means file_present. Preserve same-name image names/times. Keyboard rows show origin/size/lazy thumbnail/exceptional availability, hiding success badges/MIME parameters/IDs/absolute paths even in tooltip; paths remain action inputs. Phone labels wrap beside accessible download/folder/source.

Temporary files appears only when present, with Back/preview/confirmed cleanup; Process files has no blanket delete. Restore focus/scroll, active work/downloads block cleanup. Failed pages offer Retry beside retained data. Body alone scrolls in stable viewport; complete locales and [loading continuity](../ui/page-loading-continuity.md#page-continuity) apply.

## Cleanup/deletion
List<=200 after<=10000entries, disclose truncation/lower bound. Confirmed RWX cleanup pins owned roots, rejects symlinks/checks opened identity; path grants no delete authority. Active/queued turns/interactions/admitted work/unreaped terminals block via admissions/canonicalView. Deletion settles canonical work/stops owned terminals; force explicitly cancels. Resume settings cleanup only after Summary ErrThreadDeleted. Maintenance handles50settings/pass/bounded waits, advances failures/retries next cycle. Clean files before product/child records; remove anchors only after success.

Cleanup preserves uploads/images. Deletion releases claims while canonical retention protects queues/forks/references. Exclude finals; archive deletes nothing/noTTL. Disclose project-local state.

# Boundaries

Legacy tmp/task-evidence names prove no ownership; leave for explicit inspection/deletion, never relocate/guess. Complete terminal logs/immutable snapshots remain separate capabilities.

# Evidence

internal/ai/task_files.go/task_files_test.go/conversation_files_regression_test.go cover ownership/publication/restart/attachments. Browser covers phone/themes/search/partial/cancel/routing/focus/cleanup and layer4000 preview/keyboard/temporary/same-name/HTML/Markdown in both hosts. task_files_qualification_test.go uses configured deepseek-flash/isolated state with config/secrets/model preserved; verifies clean project/cross-turn reuse/final provenance/Fork/nestedFork after ancestor cleanup/restart/deletion/change detection/final retention.

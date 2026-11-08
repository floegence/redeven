---
type: AI Runtime Contract
title: Flower working files and deliverables
tags: [flower, files, tools, storage, permissions]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Flower keeps intermediates in Runtime state and finals at the user's destination. Private roots grant no sibling authority. Registry [filesystem policy](tool-permission-runtime.md) applies to every file/patch operation; cwd only resolves paths. Transactionally publish settings/validated canonical upload claims while retaining the source-deletion gate.

# Contract

## Placement and authority
Runtime owns `<StateDir>/task-files/<ThreadID>/{scratch,staging}`; finals belong at the requested destination or selected project/worktree, independent of temporary cwd. Admission/provider context publish identical absolute roots. System placement overrides skills without filename heuristics or new permissions; source/tests/builds retain normal locations. Children get FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, never FLOWER_OUTPUT_DIR; cwd/HOME/cache/TMPDIR keep normal semantics.

Reject escaping symlinks/siblings without adding whitelists for authorized external/detached roots.

## Fork and recovery
Fork copies current scratch/staging even at historical cuts, not historical file snapshots; projects/finals remain shared. Block source admissions/cleanup, cancellably drain admitted work and reject unreaped processes. Rooted bounded copying preserves executable bits, checks identity/size/time/final tree, rejects unsupported types/external/hard links and renames complete private staging only.

Unadmitted copies stay invisible; canonical replay finishes preparation without recopying admitted edits/cleanup. Source markers support interrupted publication/context, survive cleanup and disappear on deletion. Recheck ownership before failed-copy removal.

Startup/periodic recovery scans 50 names/batch, skips in-flight gates and removes private stages/marked forks lacking settings. Explicit orphan operations share the target gate. Retry keeps canonical identity but copies afresh. Context maps ancestor suffixes, including nested forks; request inspection/repair of hardcoded paths without rewriting history. Ancestor cleanup cannot delete descendants.

## Delivery and discovery
file.present validates/hashes an authorized regular file outside application state, cancellably checking identity/size/mtime. Return path/title/MIME/size/SHA-256/mtime/endpoint and thread/turn/run IDs; never relocate originals.

Files discovers successful authorized Floret results (50 records/page,32 KiB/record), preserving Fork/restart provenance without crawling or another ledger. Available means accessible with unchanged size/mtime; history does not rehash. Changed/missing/unavailable are observations.

Default view is deliveries/uploads; Process files separates tool images/Temporary files without changing retention. One controller reads 50-item/128-byte-preview windows through empty/search results until cursor end; viewport end advances. Initial sources may parallelize, then serialize. Repeated cursors expose Retry; temporary navigation/child preview pauses discovery. No full View/retention scan.

Same-owner refresh retains equal/successful rows, focus and scroll. Thread/runtime change invalidates; close/change aborts discovery/previews/download reads and fences late replies. Partial failure keeps successful rows. Floe Dialog owns placement/focus/Tab/Escape/row restoration; close retains query/filter/scroll, folder handoff closes it. Env supplies rich renderers; Desktop supports image/PDF/text/Markdown and opaque-origin sandboxed HTML, otherwise Download.

loadTaskFile uses validated endpoints, reauthorizes each 256 KiB, rejects version/offset drift, caps previews at20 MiB and streams downloads. Desktop permits exact thread endpoints/query keys with IPC cancel. Browser Blob sinks retain their memory cost; reads never publish originals.

## Downloads and panel
Enqueue before destination selection in Shell Downloads: Env top bar, one Desktop full/companion owner. Deliveries/temp use validated chunks; uploads/images use attachment reads. Retry binds original thread/source/runtime; metadata stores no URLs/Blobs.

The manager owns progress/destination/cancel/failure/retry/completion. List/thread changes stop previews, not admitted downloads. Reopened lists consult active downloads before cleanup. Late settlement cannot revive cancellation; finalization cannot cancel. Native destinations offer Reveal/Open; identify browser handoff. Retain records until Shell exit/Clear finished, never import OS history.

Use published Floe controls/icons/tokens. Title/close in header, search/refresh in body; filters only for multiple known kinds, vanished selection resets All. No ambiguous totals, empty headings, collapsed images or manual paging. Delivered means file.present. Keep same-name image names/timestamps. Rows offer keyboard preview, origin/size, lazy thumbnails and exceptional availability; hide success badges/MIME parameters/IDs/absolute paths even in tooltips. Paths remain action inputs. Phone names wrap beside accessible download/folder/source actions.

Temporary files appears only when present, with Back/preview/confirmed cleanup; Process files has no blanket cleanup. Restore focus/scroll; active work/downloads disable cleanup. Failed pages expose Retry beside retained content. Only body scrolls in a stable responsive viewport; explicit locales and [loading continuity](../ui/page-loading-continuity.md#page-continuity) apply.

## Cleanup/deletion
List <=200 files after <=10,000 entries, disclosing truncation/lower bounds. Confirmed RWX cleanup pins Runtime-owned roots, rejects symlinks and checks opened identities; paths grant no deletion authority. Active/queued turns, interactions, admitted work and unreaped terminals block it through in-memory admissions/canonical View.

Deletion settles canonical work/stops owned terminals; force explicitly cancels. Resume from settings only after Summary confirms ErrThreadDeleted. Maintenance handles50 settings/pass with bounded waits, advances failures and retries next cycle. Clean files before product/child state; remove anchors only on success.

Cleanup preserves uploads/images. Deletion releases upload claims while canonical retention protects other queues/forks/references. Exclude finals; archival deletes nothing and has no TTL. Disclose project-local state.

# Boundaries

Legacy tmp/task-evidence names prove no ownership: leave them for explicit browser inspection/deletion. Never relocate history or guess ownership. Complete terminal logs and immutable snapshots remain separate, unclaimed capabilities.

# Evidence

- [File owner](../../internal/ai/task_files.go), [lifecycle tests](../../internal/ai/task_files_test.go) and [publication/restart/attachment regressions](../../internal/ai/conversation_files_regression_test.go).
- Browser acceptance covers theme/phone/search/partial failure/cancel/routing/focus/cleanup; layer-4000 hit tests cover foreground previews, keyboard, temporary reads, same-name images and HTML/Markdown in both carriers.
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go): configured V4.1 Flash (1017), deepseek-flash, isolated state; preserve source config/secrets/selected production model. Verify project cleanliness, cross-turn reuse, final placement/provenance, Fork/nested Fork after ancestor cleanup, restart, parent deletion, modification detection and final preservation.

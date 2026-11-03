---
type: AI Runtime Contract
title: Flower working files and deliverables
tags: [flower, files, tools, storage, permissions]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Flower keeps intermediates in Runtime state and finals at the user's destination. Redeven owns bytes, filesystem policy and UI; Floret owns canonical results and identities. Files, Fork and cleanup preserve this boundary without another artifact index, transcript, upstream API or domain migration.

# Contract

## Placement and authority
Runtime owns <StateDir>/task-files/<ThreadID>/{scratch,staging}. Finals go to the requested destination or selected project/worktree, independent of temporary cwd. Admission/provider context publish identical absolute roots. System placement overrides skills without filename heuristics or extra permissions; source/tests/builds keep normal locations. Children receive FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, never FLOWER_OUTPUT_DIR. cwd/HOME/cache/TMPDIR retain normal semantics; long thread paths never become TMPDIR.

Private roots grant no sibling authority. All file/patch tools use registry policy; patch cwd only resolves paths. Reject escaping symlinks/siblings; authorized external/detached roots need no extra whitelist. See [editing policy](tool-permission-runtime.md).

## Fork
Fork copies current scratch/staging even at historical cuts; these are not file snapshots, and projects/finals stay shared. Block source admissions/cleanup, drain admitted work cancellably and reject unreaped processes. Bounded rooted copying preserves executable bits, verifies identity/size/time/final tree, rejects unsupported types/external links/hard links, and renames only complete private staging.

After copying, transactionally publish settings and validated canonical upload claims while retaining the source-deletion gate. Unadmitted copies stay invisible. Canonical replay finishes preparation without recopying an admitted edited/cleaned fork. Source markers support interrupted publication/context, survive cleanup and disappear on deletion. Recheck ownership before removing failed/canceled copies.

Startup/periodic recovery scans 50 names/batch, skips in-flight target/staging gates and removes private stages/marked forks without settings. Explicit orphan operations share the target gate. Retry keeps canonical identity but makes a fresh copy. Context maps ancestor suffixes into the new root, including nested forks, and asks for inspection/repair of hardcoded paths; never rewrite history. Ancestor cleanup cannot delete descendants.

## Delivery and discovery
file.present validates an authorized regular file outside application state and hashes cancellably with identity/size/mtime checks. It returns path/title/MIME/size/SHA-256/mtime/endpoint and thread/turn/run IDs; it never moves/uploads/deletes originals.

Files reads successful authorized Floret results, 50 records/page and 32 KiB/record, preserving Fork/restart provenance without crawling or a second ledger. Available means accessible with unchanged size/mtime; delivery hashes are not rechecked history. Changed/missing/unavailable are observations, not hidden versions.

Files defaults to deliveries/uploads; Process files separates tool images and Temporary files without changing retention/history. One controller discovers 50-item windows with 128-byte previews, advancing at viewport end, through empty windows and during search; only cursor end proves completeness. Independent initial sources may run together, then serialize. Repeated cursors expose Retry; temporary navigation/child preview pauses discovery. Never read full View/retention history.

Same-owner refresh preserves successful/equal rows; append retains focus/scroll. Thread/runtime changes invalidate content. Close/change aborts discovery/previews/download reads and fences late replies; partial failure preserves other rows. Floe Dialog owns placement/focus/Tab/Escape/row restoration; closing retains query/filter/scroll. Folder handoff closes the dialog. Env App supplies rich renderers; shared Desktop supports image/PDF/text/Markdown and opaque-origin sandboxed HTML. Other formats offer Download.

loadTaskFile uses existing validated endpoints, reauthorizes every 256 KiB, rejects version/offset drift, caps previews at 20 MiB and streams downloads. Desktop permits exact thread endpoints/query keys with IPC cancellation. Browser Blob sinks retain their memory cost; reads never publish/relocate originals.

## Downloads
Enqueue before destination selection in the existing Shell Downloads manager: Env App top bar; one shared Desktop full/companion owner. Deliveries/temporary files use validated chunks; uploads/images use attachment reads. Retry binds original thread/source/runtime; metadata stores no URLs/Blobs.

The manager alone owns progress/destination/cancel/failure/retry/completion. Closing lists or changing threads stops previews, not admitted downloads. Reopened lists consult active thread downloads before cleanup. Cancellation stays terminal after late destination/read/write settlement; finalization cannot cancel. Native destinations offer Reveal/Open; identify browser handoff. Records last until Shell exit or Clear finished; do not import OS/browser history.

## File panel
Use published Floe controls/icons/tokens. Header holds title/close; body holds search/refresh. Show source filters only for multiple known kinds; vanished selection resets to All. No ambiguous totals, empty headings, collapsed images or manual paging. Delivered files means file.present results. Same-name images retain names/timestamps.

Rows offer keyboard preview, origin/size, lazy thumbnails and exceptional availability; omit success badges, MIME parameters, endpoint IDs and absolute paths, including tooltips. Paths remain action inputs. Localized names wrap beside accessible download/folder/source actions on phones. Temporary files appears only when present, with Back/preview/confirmed cleanup; Process files has no blanket cleanup. Return restores focus/scroll; active work/downloads disable cleanup.

Feedback preserves controls; failed pages expose Retry beside successful content. Only the body scrolls in a stable responsive viewport. All locales are explicit; [loading continuity](../ui/page-loading-continuity.md) applies.

## Cleanup
List <=200 files after <=10,000 entries; disclose truncation/lower bounds. Confirmed RWX cleanup pins owned scratch/staging from Runtime state, rejects symlinks and verifies opened identities. Paths grant no deletion authority. Active/queued turns, interactions, admitted work and unreaped terminals block cleanup using in-memory admissions/canonical View, not a ledger.

Deletion first settles canonical work/stops owned terminals; force explicitly cancels. Resume interrupted deletion from settings only after Summary confirms ErrThreadDeleted. Maintenance processes 50 settings/pass with bounded waits, advances past failures and retries next cycle. Clean files before product/child state; remove anchors only on success.

Cleanup preserves uploads/images; deletion releases upload claims while canonical retention protects other queues/forks/references. Finals are excluded; archival deletes nothing and has no TTL. Disclose project-local state.

# Boundaries

Legacy tmp/task-evidence names prove no ownership: leave them for explicit browser inspection/deletion. Never relocate history or guess ownership. Complete terminal logs and immutable snapshots remain separate, unclaimed capabilities.

# Evidence

- [File owner](../../internal/ai/task_files.go), [lifecycle tests](../../internal/ai/task_files_test.go) and [publication/restart/attachment regressions](../../internal/ai/conversation_files_regression_test.go).
- Browser acceptance covers theme/phone/search/partial failure/cancel/routing/focus/cleanup; layer-4000 hit tests cover foreground previews, keyboard, temporary reads, same-name images and HTML/Markdown in both carriers.
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go): configured V4.1 Flash (1017), deepseek-flash, isolated state; preserve source config/secrets/selected production model. Verify project cleanliness, cross-turn reuse, final placement/provenance, Fork/nested Fork after ancestor cleanup, restart, parent deletion, modification detection and final preservation.

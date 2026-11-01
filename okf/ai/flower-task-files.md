---
type: AI Runtime Contract
title: Flower working files and deliverables
tags: [flower, files, tools, storage, permissions]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower stores intermediate files in Runtime state and final files at the user's destination. Redeven owns filesystem policy, bytes and UI; Floret owns canonical results/identities. No artifact index, transcript copy, new upstream API or domain migration.

# Contract

## Placement and authority
Runtime owns <StateDir>/task-files/<ThreadID>/{scratch, staging} for intermediates. Final files use the requested destination or selected project/worktree, independent of temporary cwd. Admission/provider context publish identical absolute roots. System placement overrides skill suggestions without filename heuristics or permission changes. Source/tests/builds retain normal locations. Terminal children receive FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, never FLOWER_OUTPUT_DIR; cwd/HOME/cache/TMPDIR keep normal semantics and OS temp its lifecycle. Long thread paths cannot become TMPDIR.

The private writable root grants no sibling/project authority. All file/patch tools share registry policy; patch cwd resolves relative paths only. Reject sibling roots and escaping symlinks. Authorized external/detached roots need no additional whitelist; [editing policy](tool-permission-runtime.md) applies.

## Fork
One action copies current scratch/staging even for historical conversation cuts; files are not historical snapshots and projects/finals remain shared. Exclude new source admissions/cleanup, drain admitted work cancellably and reject unreaped processes. Rooted bounded copying preserves executable bits, checks identity/size/time/final tree, rejects unsupported types/external links/hard links, and renames only complete private staging into the new ThreadID.

Publish settings and validated canonical upload-retention claims transactionally after copying, retaining the source-deletion gate. Failed/unadmitted work stays invisible. Canonical Fork replay finishes preparation without recopying admitted edited/cleaned forks. A source marker supports interrupted publication/context only; cleanup preserves it, deletion removes it. Recheck ownership before removing failed/canceled unadmitted copies.

Startup/periodic recovery scans 50 names per batch, skips in-flight target/staging gates and removes private stages/marked forks lacking settings. Explicit orphan operations share the target gate. Retry retains canonical identity with a fresh independent copy. Context maps ancestor suffixes to the new root and instructs inspection/repair of hardcoded paths, including nested forks; never rewrite history. Ancestor cleanup cannot delete descendants.

## Delivery and discovery
file.present verifies an authorized regular file outside application state, hashes cancellably with identity/size/mtime consistency, and returns path/title/MIME/size/SHA-256/mtime/endpoint plus canonical thread/turn/run IDs. It never moves/uploads/deletes bytes; failure preserves originals.

Files reads authorized successful canonical Floret results: 50 records/page, 32 KiB/record, preserving Fork/restart provenance without a crawl/second ledger. Available means accessible and unchanged size/mtime, not rehashed history. Hashes describe delivery-time bytes; changed/missing/unavailable are observations, not hidden versions.

Files defaults to deliveries/uploads. Process files separates canonical tool images from Temporary files; grouping changes no ownership/retention/provider history. One dialog controller discovers 50-item windows with 128-byte previews, advances at viewport end/through empty windows/during search, and declares completeness only at cursor end. After independent initial sources, requests serialize; repeated cursors expose Retry. Temporary navigation/child preview pauses discovery. No full View/retention scan.

Same-owner refresh retains successful rows/equal identities; append preserves focus/scroll. Thread/runtime changes invalidate content; close/change aborts discovery/previews/download reads and fences late responses. Partial failures preserve other rows. Floe Dialog owns child placement, focus/Tab/Escape and row restoration; closing preserves query/filter/scroll. Successful folder handoff closes the dialog. Env App supplies rich renderers; shared Desktop supports image/PDF/text, Markdown and opaque-origin sandboxed HTML. Unsupported formats offer Download.

loadTaskFile uses existing endpoints/common validation: reauthorize each 256 KiB, reject version/offset drift, cap previews at 20 MiB and stream downloads. Desktop permits exact thread endpoints/query keys with IPC cancellation. Browser Blob sinks retain their memory cost; reads never publish/relocate originals.

## Download ownership
Enqueue downloads in the existing Shell manager before destination selection. Env App uses its top-bar Downloads owner; Desktop full/companion share one manager. Deliveries/temporary files use validated authorized chunks; uploads/images use the attachment reader. Retry closures bind original thread/source/runtime; metadata stores neither attachment URLs nor Blobs.

Only the manager owns progress/destination/cancel/failure/retry/completion. Closing previews/lists or switching threads stops previews, not admitted downloads. Reopened lists consult active thread downloads before cleanup. Cancellation remains terminal after late destination/read/write settlement; finalization cannot cancel. Native destinations expose Reveal/Open; browser handoff is identified. Records last until Shell ends or Clear finished; prior OS/browser history is not imported.

## File panel presentation
Use published Floe controls/icons/theme tokens. Header: title/close; body: search/refresh. Files/Process files exposes source filters only for multiple known kinds, resetting vanished selections to All. No ambiguous totals, empty headings, collapsed images or manual paging. Delivered files labels only file.present results. Same-name images retain names and show existing timestamps.

Rows provide keyboard preview, compact origin/size, lazy thumbnails and exceptional availability, without success badges/MIME parameters/endpoint IDs/absolute paths (including tooltips). Paths remain action inputs. Localized names wrap beside accessible download/folder/source actions at phone widths. Temporary files appears only when present, with Back/preview/separate confirmed cleanup; Process files has no blanket cleanup. Return restores focus/scroll; protected work/downloads disable cleanup.

Action feedback preserves controls; page failures offer Retry without hiding successful content. Stable responsive viewport scrolls body only, retaining header/close. All locales are explicit; [loading continuity](../ui/page-loading-continuity.md) applies. Browser tests cover themes/phone/search/partial failure/cancellation/routing/focus/cleanup. Real layer-4000 hit-testing covers foreground previews, keyboard, temporary reads, same-name images and HTML/Markdown in both carriers.

## Cleanup
List at most 200 files after inspecting at most 10,000 entries, disclosing truncation/lower bounds. Confirmed RWX cleanup pins each owned scratch/staging directory from Runtime state, rejects symlinks and checks opened identities. Paths grant no deletion authority. Active/queued turns, interactions, admitted work and unreaped terminals block cleanup; in-memory admissions/canonical View suffice without a ledger.

Deletion settles canonical work/stops owned terminals first; force explicitly cancels. Interrupted deletion resumes from settings only after canonical Summary confirms ErrThreadDeleted. Maintenance handles 50 settings/pass with bounded waits, advances past failures and retries next cycle. Clean files then product state, including children; remove anchors only after success.

Cleanup preserves uploads/images; deletion releases upload claims while canonical retention protects other queues/forks/references. Exclude finals; archival deletes nothing, no TTL. Disclose project-local state.

# Boundaries

Legacy project filenames such as tmp/task-evidence prove no ownership. Leave them for explicit file-browser inspection/deletion; never guess ownership or relocate history. Complete terminal logs and immutable snapshots are separate, unclaimed capabilities.

# Evidence

- [File owner and verification](../../internal/ai/task_files.go).
- [Publication failure, restart, cleanup progress and production attachment regressions](../../internal/ai/conversation_files_regression_test.go).
- [Permission and lifecycle regressions](../../internal/ai/task_files_test.go).
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go) uses the configured DeepSeek V4.1 Flash (1017) profile (deepseek-flash) with isolated state and verifies the source config and secrets stay unchanged. It checks project cleanliness, cross-turn reuse, final placement, canonical provenance, Fork continuation, nested Fork continuation after ancestor cleanup, restart, parent deletion, modification detection and final-file preservation. It never changes the selected production model.

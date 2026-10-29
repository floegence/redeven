---
type: AI Runtime Contract
title: Flower working files and deliverables
tags: [flower, files, tools, storage, permissions]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Flower stores intermediate files in Runtime state and final files at the user's destination. Redeven owns filesystem policy, bytes and UI; Floret owns canonical results/identities. No artifact index, transcript copy, new upstream API or domain migration.

# Contract

## Placement and authority

Use <StateDir>/task-files/<ThreadID>/scratch and optional staging. Scratch persists helpers/data/captures/diagnostics; staging holds unfinished work. Admission/provider context publishes identical absolute paths. System placement guidance overrides skill suggestions for project-relative intermediates.

Terminal children receive FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, not FLOWER_OUTPUT_DIR. Preserve cwd/HOME/cache/OS-temp semantics; long thread paths cannot become TMPDIR because sockets/CLIs have limits. OS temp follows OS lifecycle. Finals use requested/established destinations, otherwise selected project/worktree, never redirected by temporary cwd. No export step. Source/tests/conventional builds keep normal paths. Prompts do not sandbox effects; filename heuristics cannot reroute writes.

Grant one private writable root without expanding project authority; deny sibling roots/symlink aliases. Fork has independent writable scratch; history grants no ancestor access. file.write/file.edit/apply_patch share the registry policy; patch cwd only resolves relative paths. Detached scratch/authorized external roots need no extra whitelist; [editing policy](tool-permission-runtime.md) applies.

## Fork

One action, without file selector/technical warning, copies current scratch/staging for current or historical cuts. Conversation follows the cut; files are not historical snapshots. Projects/finals remain shared and uncopied.

Preparation excludes new source admissions/cleanup, waits cancellably for admitted work and rejects unreaped processes. Rooted bounded-buffer copying preserves executables, verifies identity/size/time/final tree and renames only complete private staging into the new ThreadID. Reject unsupported types/external links; no hard links/writable ancestor aliases.

Publish settings and validated canonical upload-retention claims transactionally after files are ready; source deletion shares this gate through publication. Failure remains invisible/unadmitted; replay of the canonical Fork completes preparation. Never recopy admitted edited/cleaned forks. A small source marker supports interrupted publication/context, not artifact/conversation ledgers; cleanup preserves it, deletion removes it. Recheck ownership and remove unadmitted copies after failure/cancellation.

Startup/periodic recovery streams 50 directory names per batch, skips in-flight target/staging gates and removes private stages/marked forks without settings. Explicit orphan adoption/deletion shares the target gate. Retry keeps canonical fork identity and prepares a fresh independent copy; recovery never recopies/removes admitted copies.

Context instructs inspection of inherited files, mapping ancestor scratch/staging suffixes to the new root and repairing hardcoded paths, including nested forks. Never rewrite history/content or ask users to select snapshot semantics. Ancestor cleanup/deletion cannot remove descendant copies.

## Delivery and discovery

file.present verifies a regular file outside application state, hashes cancellably and checks identity/size/mtime consistency. Return path/title/MIME/size/SHA-256/mtime/endpoint plus canonical thread/turn/run IDs. Never move/upload/delete; failed publication leaves user files intact.

Files queries successful canonical results through authorized Floret APIs: 50 records/page, at most 32 KiB/record, retaining Fork/restart provenance. No startup crawl/second ledger. Recheck read authority. Available means accessible with unchanged size/mtime, not rehashed historical identity. Changed/missing/unavailable are observations; hashes describe delivery-time bytes. Files remain user-mutable, without hidden versions.

Desktop/mobile shows finals, inputs, collapsed conversation images and expandable working files. Inputs/images reuse authorized preview/download and source navigation. Discovery reads one 50-item canonical window per request with 128-byte previews, no full-history View/retention scan. Empty windows retain next cursor; refresh resets changed leaves. Keep host preview/directory routing/HTML isolation; absent callbacks use shared image/PDF/text previews and read-only listing. Reauthorize each 256 KiB download chunk and abort on version/offset drift. Desktop permits only exact thread endpoints/query keys. Downloads neither publish nor relocate originals; Blob fallback retains its memory behavior.

## File panel presentation

Use published Dialog, file-type icons and Button loading. Counted deliverable/material headings; keyboard-operable images/working-files disclosures start closed. Flat rows emphasize clickable titles, compact type/size and exceptional availability; no success badge, MIME parameters or endpoint IDs. Do not render absolute/working paths, even tooltips; retain canonical paths as action inputs. Long localized names wrap beside always-visible accessible download/folder/source icons at phone widths. Filename previews; counts are plain text and icons have no tile. One header close, refresh beside first heading, separate confirmed cleanup. Only the body scrolls; header/close remain reachable. FlowerTaskFiles.browser.test.tsx covers geometry/disclosures/source routing/stale responses/protected cleanup.

## Cleanup

List at most 200 files while inspecting at most 10,000 entries; disclose truncation/lower bounds. Confirmed RWX cleanup uses rooted owned scratch/staging only. Active/queued turns, interactions, admitted work and unreaped terminals block it. In-process admissions/canonical View suffice; no durable cleanup ledger/lease.

Deletion settles canonical work/stops owned terminals first. Interrupted deletion resumes from settings only when canonical Summary confirms ErrThreadDeleted; missing/unavailable is not authority. Maintenance processes at most 50 settings/pass with bounded per-item waits, advances past failures and retries retained anchors next cycle. Explicit/recovery paths both clean files then product state, including children; remove anchors only after success. Normal deletion refuses live work; force explicitly cancels.

Cleanup preserves uploads/images. Thread deletion releases upload claims; canonical retention protects other paths/queues/forks until the last reference. Exclude final files; archival deletes nothing, no TTL. Disclose project-local state.

# Boundaries

Legacy project filenames such as tmp/task-evidence prove no ownership. Leave them for explicit file-browser inspection/deletion; never guess ownership or relocate history. Complete terminal logs and immutable snapshots are separate, unclaimed capabilities.

# Evidence

- [File owner and verification](../../internal/ai/task_files.go).
- [Publication failure, restart, cleanup progress and production attachment regressions](../../internal/ai/conversation_files_regression_test.go).
- [Permission and lifecycle regressions](../../internal/ai/task_files_test.go).
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go) uses the configured DeepSeek V4.1 Flash (1017) profile (deepseek-flash) with isolated state and verifies the source config and secrets stay unchanged. It checks project cleanliness, cross-turn reuse, final placement, canonical provenance, Fork continuation, nested Fork continuation after ancestor cleanup, restart, parent deletion, modification detection and final-file preservation. It never changes the selected production model.

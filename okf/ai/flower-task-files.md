---
type: AI Runtime Contract
title: Flower working files and deliverables
description: Thread-owned intermediate files, canonical delivery references, authorized downloads and safe cleanup.
tags: [flower, files, tools, storage, permissions]
timestamp: 2026-10-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Flower keeps intermediate files under the Runtime's application state and final
files at the user's destination. Redeven owns filesystem policy, bytes and UI;
published Floret owns tool results and conversation identities. No artifact
index, duplicated transcript, new Floret API or domain migration is introduced.

# Contract

## Placement and authority

Paths: <StateDir>/task-files/<ThreadID>/scratch and optional staging. Scratch persists helpers, data, captures and diagnostics across turns; staging holds unfinished work. Admission/provider preparation publish the same absolute paths in managed execution context. System guidance applies even when a skill suggests project-relative intermediates.

Terminal children receive FLOWER_SCRATCH_DIR/FLOWER_STAGING_DIR, no FLOWER_OUTPUT_DIR. Cwd, HOME, package caches and OS temporary variables retain semantics. Never set long thread paths as TMPDIR (Unix sockets/CLIs); OS temp follows OS lifecycle, persistent work uses scratch.

Final files go to requested/established output destinations, otherwise selected project/worktree; temporary cwd cannot redirect them. No extra export step. Source/tests/conventional builds retain normal paths. Prompts do not sandbox shell effects, and filename heuristics cannot reroute writes.

Current policy grants one private writable root without expanding project permission; sibling roots and symlink aliases are denied. Fork gets independent writable scratch; historical references grant no ancestor access.

## Fork

One action with no file selector/technical warning copies current scratch/staging for current or historical cuts. Conversation stops at the canonical cut; files are not historical snapshots. Project/final files remain shared, uncopied and unredirected.

Preparation excludes new source admissions/cleanup, waits cancellably for admitted work and rejects unreaped processes. Rooted bounded-buffer copying preserves executable helpers and validates identity/size/time plus final tree. Rename only a complete private staging tree into new ThreadID. Reject unsupported types/external links; no hard links or writable ancestor aliases.

Publish product settings only when files are ready. Failed preparation is not visible/admitted; replaying that canonical Fork request completes preparation. Never recopy admitted forks after edits/cleanup. A small source marker supports interrupted publication/context, not artifact/conversation ledgers. Cleanup preserves it; deletion removes it. Remove unpublished copies on failure; interrupted-process retry replaces them.

Context instructs the model to inspect inherited files, map old scratch/staging suffixes into its own root and repair hardcoded paths before use, including nested forks. Do not rewrite history/content or ask users to select snapshot semantics. Ancestor cleanup/deletion cannot remove descendant copies.

## Delivery and discovery

file.present verifies a regular file outside application state, hashes cancellably and checks identity/size/mtime consistency. Return path/title/MIME/size/SHA-256/mtime/endpoint and canonical thread/turn/run identities. Never move/upload/delete; failed canonical publication cannot remove user files.

Files panel queries successful canonical results through authorized public Floret boundaries: 50 records/page, ≤32 KiB/record, original Fork/restart provenance. No startup crawl/second ledger. Recheck read authority. Available means current accessible file with unchanged size/mtime, not rehashed historical identity. Changed/missing/unavailable are observations; stored hashes describe delivery-time bytes. Files stay user-mutable, without hidden version copies.

Desktop/mobile dialog shows final results then expandable working files, source Runtime and actual path. Existing host preview/directory routing and HTML isolation remain; absent callbacks use shared image/PDF/text preview and read-only listing. Existing save destinations reauthorize each 256 KiB download chunk; version/offset drift aborts destination. Desktop allows exact thread endpoints/query keys only. Downloads neither publish nor relocate originals; browser Blob fallback retains its memory behavior.

## Cleanup

List ≤200 files while inspecting ≤10,000 entries; show truncation/lower bounds. Explicit confirmed RWX cleanup uses rooted operations on owned scratch/staging only. Active/queued turns, interactions, admitted work and unreaped terminals block it. In-process admissions and canonical view suffice; no durable cleanup lease/ledger.

Deletion settles canonical work and stops owned terminals before removing private files. Normal deletion refuses live work; force uses explicit cancellation. Final files are excluded, archival deletes nothing, no TTL; disclose project-local state.

# Boundaries

Legacy files scattered in a project remain untouched: names such as tmp or
task-evidence do not prove ownership. The existing file browser permits explicit
user inspection/deletion; this change does not guess legacy ownership or relocate
historical paths. Complete terminal-log retention and immutable file snapshots
remain separate capabilities and are not claimed here.

# Evidence

- [File owner and verification](../../internal/ai/task_files.go).
- [Permission and lifecycle regressions](../../internal/ai/task_files_test.go).
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go) uses the configured DeepSeek V4.1 Flash (1017) profile (deepseek-flash) with isolated state and verifies the source config and secrets stay unchanged. It checks project cleanliness, cross-turn reuse, final placement, canonical provenance, Fork continuation, nested Fork continuation after ancestor cleanup, restart, parent deletion, modification detection and final-file preservation. It never changes the selected production model.

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

## Placement

    <StateDir>/task-files/<ThreadID>/scratch
    <StateDir>/task-files/<ThreadID>/staging

Scratch retains helper scripts, intermediate data, screenshots and diagnostics
across turns. Staging is optional unfinished work. Admission and dynamic provider
preparation include the same absolute paths in the existing managed execution-
environment snapshot. The system prompt applies this rule even when intermediates
are retained for follow-up or a skill suggests project-relative temporary files.

Terminal child environments receive FLOWER_SCRATCH_DIR and FLOWER_STAGING_DIR.
There is no private FLOWER_OUTPUT_DIR. Project cwd, HOME, package caches and OS
temporary variables retain their existing semantics. Long thread paths are not
used as TMPDIR: Unix socket paths and CLI expectations must continue working.
OS temporary files retain OS lifecycle; persistent intermediates use scratch.

Final files go directly to the requested destination or established project
output location, otherwise the selected project/worktree. A temporary command
cwd does not change that destination. Users need no extra export step. Ordinary
project source, tests and conventional build outputs keep their existing paths.
Prompts cannot sandbox arbitrary shell or external-tool effects; no filename
heuristic silently reroutes project writes.

The task scope is a current-policy snapshot with one private writable root.
Sibling thread roots remain denied, including symlink aliases. Adding scratch
never expands normal project permissions. Fork uses a new writable scratch root; historical references never grant
access to an ancestor's working files.

## Fork continuity

Fork remains one action, without a working-file selector or technical warning.
Both current and historical conversation cuts inherit independent copies of the
source's current scratch/staging files. Conversation history stops at the selected
canonical item; working files are not historical filesystem snapshots. Project
files and final destinations remain shared and are never copied or redirected.

Preparation excludes new source filesystem admissions and cleanup, waits for
admitted operations with caller cancellation, and refuses unreaped background
processes. Copying uses rooted operations, bounded buffers, executable helper
preservation, source identity/size/time checks and a final tree validation. Only a
complete private staging tree is renamed into the new ThreadID directory.
Unsupported file types and external links fail without following them. No hard
links or writable parent aliases are created.

Product settings are published only after files are ready. Failed preparation is
not a visible/admitted product thread; replaying the same canonical Fork request
finishes preparation. An already admitted fork is never recopied, including after
its work files have been edited or explicitly cleaned. A small file-source marker
supports interrupted publication and dynamic context; it is not an artifact or
conversation ledger. Cleanup preserves the marker, while thread deletion removes
it with the private root. Unpublished copies are removed on failure and replaced
on retry after a process interruption.

The current execution-environment context tells the model to inspect inherited
files, map old scratch/staging paths by their relative suffix into its own root,
and repair hardcoded helper paths before execution. This applies to nested forks
without rewriting history or file contents. The model handles these details
internally; users are not asked to choose directory or snapshot behavior. Cleanup
or deletion of an ancestor cannot remove a descendant's independent files.

## Delivery and discovery

The file.present tool verifies a regular file outside application state, hashes
bytes with cancellation, checks file identity/size/modification consistency, and
returns its path, title, MIME, size, SHA-256, modification time, endpoint and
canonical thread/turn/run identities. It never moves, uploads or deletes the
file. A failed canonical result cannot remove an already-written user file.

The Files panel queries successful canonical file.present results through the
public authorized Floret query/read boundary. It pages 50 results, bounds each
record to 32 KiB, and preserves original provenance through Fork and restart.
There is no startup filesystem crawl or second durable delivery ledger. Read
permissions are checked again; canonical references are not authorization.

Available means the current file is accessible with unchanged size/modification
metadata. Changed, missing and unavailable states describe current observations;
listing does not rehash large files or assert byte-for-byte historical identity.
The stored hash describes delivery-time bytes. Final files remain user-owned and
mutable; no invisible version copies are created.

The shared desktop/mobile Files dialog shows final results first and expandable
working files second. Existing preview and directory actions retain their host
routing and HTML isolation. Hosts without those callbacks use the shared image,
PDF and text preview and a read-only directory listing. Source Runtime and actual
saved path stay visible.
Downloads use the existing native/browser save destinations and reauthorize each
256 KiB source chunk. Size/modification version drift or inconsistent offsets
abort the destination. Desktop routes admit only exact thread endpoints and
validated query keys. Downloads do not publish files or change their original
location. Browser Blob fallback retains its existing browser-memory behavior.

## Cleanup

The panel lists at most 200 working files and inspects at most 10,000 entries;
truncation and lower-bound totals are visible. Manual cleanup requires RWX and
an explicit confirmation. It removes only owned scratch/staging, with rooted
filesystem operations. Active/queued turns, pending interactions, admitted tool
work and unreaped terminal processes prevent cleanup. In-process admission
counts and the existing canonical view are sufficient; no durable cleanup ledger
or lease exists.

Thread deletion settles canonical work and terminates its owned terminal
processes before removing its private tree. Normal deletion refuses live work;
force deletion uses the existing explicit cancellation semantics. Final files
are never in cleanup scope. Archival has no automatic file deletion. No TTL is
enabled. Project-local application state is disclosed in the panel.

# Boundaries

Legacy files scattered in a project remain untouched: names such as tmp or
task-evidence do not prove ownership. The existing file browser permits explicit
user inspection/deletion; this change does not guess legacy ownership or relocate
historical paths. Complete terminal-log retention and immutable file snapshots
remain separate capabilities and are not claimed here.

# Evidence

- [File owner and verification](../../internal/ai/task_files.go).
- [Canonical queries, downloads and cleanup](../../internal/ai/task_files_service.go).
- [Permission and lifecycle regressions](../../internal/ai/task_files_test.go).
- [Fork copies, retry, cancellation and publication regressions](../../internal/ai/task_files_fork_test.go).
- [Canonical Fork/restart regression](../../internal/ai/task_files_persistence_test.go).
- [Authenticated HTTP chunk regression](../../internal/codeapp/appserver/server_ai_task_files_test.go).
- [Desktop/mobile dialog regression](../../internal/envapp/ui_src/src/ui/FlowerTaskFiles.browser.test.tsx).
- [Destination abort and bounded chunk tests](../../internal/envapp/ui_src/src/ui/downloads/flowerTaskFileDownload.test.ts).
- [Explicit local DeepSeek qualification](../../internal/ai/task_files_qualification_test.go) uses the configured DeepSeek V4.1 Flash (1017) profile (deepseek-flash) with isolated state and verifies the source config and secrets stay unchanged. It checks project cleanliness, cross-turn reuse, final placement, canonical provenance, Fork continuation, nested Fork continuation after ancestor cleanup, restart, parent deletion, modification detection and final-file preservation. It never changes the selected production model.

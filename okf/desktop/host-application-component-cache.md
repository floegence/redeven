---
type: Desktop Contract
title: Host application component cache
description: Reuse verified graphical component archives across devices and present actual download and transfer progress.
tags: [desktop, applications, cache, installation]
timestamp: 2026-09-24T16:00:00Z
---
# Summary

The released `floe-native-apps/artifactcache` SDK owns archive verification,
exclusive cache access and eviction. Redeven Desktop owns its private directory,
seven-day idle retention and 2,000,000,000-byte archive budget, document-scoped
transfer files and localized presentation. Multiple devices reuse the same
verified publisher files; upload remains independent for each host. Cancellation
preserves completed archives. Unknown catalogs fail explicitly, and cleanup
failures never replace successful preparation with an installation failure.

# Contract

## Acquisition and retention

Desktop delegates to its bundled Runtime's `host-application-package` command.
That command and the receiving host select the same published `DesktopForPlatform`
combined recipe. Retained Xpra resources are not replaced by this transfer.
The cache lives under the Desktop user-data directory at
`native-application-components/cache/archives`. SHA-256 identifies original
publisher bytes, independent of device identity. Different architectures can
reuse identical common files; all others must match their pinned catalog entry.
Renderer input selects only reviewed architecture and receiver-plan identities,
never URLs, executables, policy values or filesystem paths.

The SDK's OS-backed exclusive lease covers inspection, download and every archive
read during ZIP creation. Preparation for the same cache serializes; uploads of
completed ZIPs can proceed concurrently. Waiters can cancel independently. If the
active process exits, its lease is released and the next process rechecks the
cache. An interrupted individual download may restart, but completed files remain.

Successful use refreshes archive mtime. Existing cache files are reused in place;
their original mtime supplies the initial last-use value. No index database or
installation migration is introduced. Explicit maintenance removes archives idle
for more than seven days, then evicts the least recently used files until the
archive budget is met. The budget excludes active temporary download and ZIP
space. Maintenance never races with a leased reader. Only recognized regular
files are removed; symlinks, unknown files, subdirectories and the lease file are
preserved.

Desktop attempts nonblocking maintenance on startup and after cancellation or
transfer cleanup. Bundle preparation also performs maintenance after its last
archive read, including after failure. A busy startup maintenance attempt skips
without delaying the application. An expired file is removed at the next
maintenance opportunity, not by a service running while Desktop is closed.
Maintenance diagnostics remain distinct from download and installation errors.
Other component consumers do not inherit this product's eviction policy.

## Temporary transfer ownership

The initiating Desktop document owns its subprocess and temporary ZIP. Completion,
cancellation, navigation and document destruction retire that transfer after the
exact subprocess has exited. Cache maintenance operates on original archives,
not the ZIP being uploaded. After acquiring its user-data single-instance lock,
Desktop removes only recognized transfer directories from its previous process;
initialization completes before new transfer directories are created.

The receiving host still owns its missing-file plan, upload admission, received
bytes, integrity checks and qualification. The
[preparation contract](../architecture/host-application-preparation.md) owns those
boundaries and pending application opening.

## Honest progress and recovery

The delivery choice explains that Desktop reuses its cache and downloads only
missing components. The pre-start size names files missing on the host; it is
not a claim about internet download volume on Desktop.

After explicit preparation, waiting and checking have unknown cache/download
totals and no percentage. Once inspection completes, the SDK reports verified
cache bytes and required download bytes. Download progress counts only actual
network reads. Packing is indeterminate. A fully cached operation explains that
no download is needed. Upload progress comes from the host's received-byte
snapshot, including when it resumes an earlier upload.

One presentation path supplies the page, preparation dialog and reserved app
window. Desktop acquisition is short-lived presentation state, not a replacement
host operation record. The bridge advertises cache-progress support; an older
Desktop produces an update message before acquisition, without inventing cache
hits or switching delivery methods. Closing a reserved app window still retires
its launch intention.

# Boundaries

This policy applies only to Desktop graphical component archives. It does not
manage user downloads, browser packages, host-installed components or another
Desktop profile. Application permissions, host qualification and launch ownership
remain with their existing product and SDK owners. Temporary ZIPs are transfer
resources and are not included in the persistent archive capacity.

# Evidence

- [Runtime adapter](../../cmd/redeven/host_application_package.go): fixed retention policy, released SDK calls and independent maintenance diagnostics.
- [Desktop ownership](../../desktop/src/main/hostApplicationComponents.ts): startup cleanup, scoped subprocesses and bounded chunk reads.
- [Desktop regression tests](../../desktop/src/main/hostApplicationComponents.test.ts): cancellation, cache preservation and temporary-file boundaries.
- [Preparation presentation](../../internal/envapp/ui_src/src/ui/pages/HostApplicationSetupPanel.tsx): shared stage, cache explanation and byte progress.
- [UI acceptance](../../internal/envapp/ui_src/src/styles/hostApplicationUpdates.browser.test.tsx): locale, narrow-layout and accessibility coverage.
- [Two-host acceptance runner](../../desktop/scripts/check-host-component-cache.mjs): isolated Electron restart, production component bridge, and Linux Runtime preparation routes.
- [Upstream release qualification](https://github.com/floegence/floe-native-apps/actions/runs/36019124523): native amd64/arm64 installation and Windows process-lock evidence for v0.9.0.

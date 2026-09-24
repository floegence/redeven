---
type: Architecture Contract
title: Remote browser files
description: Transfer exact source files through authorized browser views.
tags: [architecture, browser, files, privacy]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

- Authority: the Runtime authorizes a source view and FloeBrowser owns its file handles and capture lifecycle.
- Outcome: users upload to a selected source input and explicitly save source-generated downloads through Flowersec.
- Invariants: file identities belong to their admitted source; captures preserve original bytes and source request semantics; personal browser directories are never scanned.
- Failure boundary: revoked views, expired handles and unsupported download forms fail explicitly without refetching a URL or selecting another file.

# Download ownership

The [remote browser surface](remote-browser-surface.md) owns source admission,
control and view lifecycle. Its existing Fetch owner passes source response
pauses to FloeBrowser's `ResponseDownloads`. Successful Document responses with
an attachment disposition or an explicit `application/octet-stream` MIME type
are consumed once through the original CDP IO stream. Cookies, POST bodies and
side effects remain those of the original source request. No second network
request or browser-wide download setting is introduced.

Managed profiles retain the browser's owned download policy and GUID-named files.
Their source adapter exposes the semantic controller's exact native download
handles through the published `SourceDownload` contract. A borrowed CDP connection
does not manufacture Playwright handles or reset browser-wide download behavior.
Opening validates the exact GUID path and file size and rejects symbolic links;
closing the source retires its reader authority without scanning the directory.

For external sources, the source adapter observes object URLs created in admitted frame documents.
A native Blob download event selects the exact immutable Blob and reads its CDP
IO handle, including when the website immediately revokes the object URL. The
observer preserves native URL behavior. Source disposal restores observed URL
functions and releases retained references; it does not revoke website-owned
URLs. Other personal tabs retain their native download behavior.

Capture has explicit bounds: four receiving files, 128 retained download records,
256 MiB per file, 512 MiB total temporary storage and five minutes per receive.
Blob observation retains at most sixteen current frame contexts, 128 references
and 32 MiB per context. Revoked Blob references expire after thirty seconds.
Blobs created before observation, in unobserved workers or frames, or beyond the
bounds are unavailable. Native downloads outside the supported response forms
require a native source handle; neither URL refetch nor directory scanning is a
fallback. Hosts using response capture disable duplicate Playwright handles.

# Authorized transfer and cleanup

The browser download panel exposes source-provided names and states. Saving is
an explicit user action. Runtime file routes validate the current view, target
grant and opaque download identity before opening its byte stream. Revoking
the view cancels its transfer. Canceling a receiving capture closes its source
stream; source disposal removes task-owned temporary files.

The environment reads opaque resource and download identities through its
current Session HTTP carrier, then transfers bytes over the view's product port.
Resource reads are bounded to 8 MiB each; download reads to 256 MiB each and four
concurrent downloads. Reads share a 256 MiB in-flight byte budget, reject truncated
responses and cancel when their request or view ends. The trusted document
creates only local Blob destinations. It receives no generic HTTP operation or
control token. FloeBrowser's published `fetchResource` adapter owns replay
resource presentation and its separate decoded-resource limits.

Uploads travel through the authenticated Flowersec upload stream to source
temporary storage and apply only to the selected live source file input.
Desktop save dialogs and Web browser downloads are client-side destinations;
the replay document receives no filesystem or Desktop bridge.

# Evidence

- `floebrowser:src/host/response-downloads.ts` - Original response capture, bounded temporary files and disposal.
- `floebrowser:src/host/blob-downloads.ts` - Frame-scoped immutable Blob observation and native IO handles.
- `floebrowser:test/blob-downloads.e2e.ts` - Repeat exports, unrelated pages, iframe replacement and cleanup.
- `floebrowser:test/response-downloads.e2e.ts` - Original POST bytes, cancellation and immediate Blob revocation.
- `redeven:internal/envapp/ui_src/scripts/computerManagedDownloads.mjs` - Managed native handles with exact-file validation.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.mjs` - Shared source adapter and file capture owner.
- `redeven:browser-extension/background.mjs` - Native IO handles restricted to the admitted binding.
- `redeven:internal/codeapp/appserver/browser_files_api.go` - Current-view download authorization.
- `redeven:internal/envapp/ui_src/scripts/checkBrowserProjection.mjs` - Exact-byte Desktop/Web transfers over Flowersec.

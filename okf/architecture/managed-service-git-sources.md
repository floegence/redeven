---
type: Runtime Contract
title: GitHub service template sources
description: Import and manually review original GitHub template directories through Desktop transfer or direct Runtime acquisition.
tags: [architecture, templates, desktop, credentials, persistence]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

- Authority: upstream owns acquisition and format validation; Redeven owns authenticated import, user review, and the active-directory pointer.
- Outcome: public/private GitHub templates import through Desktop transfer or direct Runtime download without an installed `git` executable.
- Invariants: no background source checks, automatic source updates, dependency installation, script execution, application upgrade, or restart occurs during source import/review. Credentials remain request-scoped.
- Failure boundary: validation or confirmation failure keeps the active source. One missing, corrupt, or unsupported source blocks only that template and its associated operations; there is no old-definition fallback.

# Contract

## Acquisition and credentials

The template center exposes Import from GitHub and Check template updates. Desktop defaults to local acquisition and transfers the original snapshot to the selected Runtime; a browser offers direct Runtime acquisition. Both paths use the same released upstream GitHub API contract and Runtime validation. Neither invokes a host Git binary. Template Release attachments are outside this source contract; existing service-package acquisition is unchanged.

Repository links, directory links, and declaration-file links resolve a repository, ref, and template path to an exact commit. An omitted ref uses GitHub's actual default branch. A repository root may contain one template; `templates/` may contain independent template directories for explicit selection. Download covers the selected template directory, including localized display, passive icons, and helper scripts. It never fetches application packages, npm dependencies, or images.

Private tokens are sent only to `https://api.github.com` with redirect rejection. Desktop tokens remain in the owning Environment window's acquisition operation; transferred snapshots contain no token. Remote mode sends the token through the authenticated session to the selected Runtime for this request. Tokens never enter source records, previews, audit details, service environment, or durable state. Renderer destruction/cancellation aborts its Desktop acquisition; another renderer cannot cancel or claim the operation.

The public limits are 1,024 files, 2 MiB per file, 16 MiB per directory, 1,024 UTF-8 bytes per relative path, and 32 directory levels. Discovery above 100 candidate directories requires an explicit path. Only regular files with Git modes `100644` or `100755` are accepted. Traversal, conflicting/case-colliding paths, symlinks, submodules, LFS pointers, truncated listings, and inconsistent Git blobs are rejected. The whole-directory SHA-256 covers sorted relative path, executable mode, and each file's SHA-256. UI transfer requests have a 24 MiB encoded-body ceiling.

## Review and confirmation

All source endpoints require the existing full Port Forward permission. POST `source-discovery` lists candidates; POST `source-previews` captures and validates a selected source; POST `source-previews/<candidate>/file` exposes original before/after file bytes as inert UTF-8 text, or binary digest and mode. Preview responses are private and non-cacheable. Candidates belong to the authenticated session identity, expire after 15 minutes, and are limited to eight in-memory reviews. DELETE `source-previews/<candidate>` discards a review without changing the active source.

Preview displays the exact commit, author revision, original/effective format versions, changed files, execution specifications before/after, and affected service names. File inspection never executes or renders source content as HTML. Confirmation is a separate user action. Unchanged directory content is reported as up to date even when unrelated repository commits advanced.

POST `source-confirmations` binds a request ID, candidate ID, candidate digest, and expected old digest. The candidate and original active files are validated again. A changed local directory or stale review requires another check. Request retries use a persisted receipt and never reapply a source. Saved repository ID, ref, path, document identity, service family, and deployment identity remain fixed for an imported template; a different identity requires a separate import.

Related pending/running/cancelling service operations and active opening hooks block replacement. The source update preserves local template identity, family identity, existing service association, installed release, configuration, resource ownership, and running process. Subsequent explicit lifecycle operations resolve the newly selected current definition. The source digest participates in install/update review and applied Runtime identity, so a helper-only edit cannot reuse an obsolete reviewed operation.

## Atomic directory ownership

`<managed-state>/template-sources/source_<opaque-id>/` contains the original files only. Registry version 5 adds source repository/ref/path, commit, whole-directory digest, opaque active-directory identity, and presentation/identity indexes. It adds no executable definition to `managed_web_service_templates`. Imported template/family IDs derive from numeric repository namespace plus author identity, preventing name collisions with official templates and other repositories.

Confirmation writes and fsyncs a complete new private directory, then a Registry transaction compares the old digest, checks related operations, switches the active pointer, and records the request receipt. Only after commit may the previous directory be removed. A failed write/transaction preserves the current pointer. An uncertain commit never deletes a potentially active directory; retry receipts and startup cleanup resolve complete unclaimed directories. A crash before commit leaves an unclaimed staging directory; after commit the new complete directory remains authoritative. Startup removes only unreferenced source directories, never repairs or replaces a corrupt active source.

# Boundaries

Host hooks receive `REDEVEN_TEMPLATE_DIR` for original helper files. Workspace, process, port, output, and secret rules remain owned by the [Host lifecycle](independent-host-services.md). [Format compatibility](service-template-format-compatibility.md) owns in-memory historical conversion. [Registry migration](database-schema-migrations.md) owns the contiguous version-4-to-5 metadata migration and atomic rollback.

# Evidence

- `redeven:internal/managedwebservice/template_sources.go` - Owns review, current source resolution, source identity, confirmation, and orphan cleanup.
- `redeven:internal/portforward/registry/template_sources.go` - Stores source metadata and commits the source pointer with its receipt atomically.
- `redeven:internal/portforward/registry/template_sources_test.go` - Verifies the v4-to-v5 edge, rollback, stale confirmation, and absence of executable projections.
- `redeven:internal/codeapp/appserver/managed_template_sources_test.go` - Verifies full permission and private request handling.
- `redeven:desktop/src/main/templateSources.integration.test.ts` - Captures the shared directory fixture with the published SDK and no Git executable.
- `redeven:internal/envapp/ui_src/src/ui/pages/GitTemplateImport.browser.test.tsx` - Verifies responsive review, inert script inspection, and explicit confirmation in Chromium.

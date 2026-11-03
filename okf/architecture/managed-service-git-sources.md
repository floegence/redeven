---
type: Runtime Contract
title: GitHub service template sources
tags: [architecture, templates, desktop, credentials, persistence]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Upstream acquires/validates templates; Redeven authorizes import/review/active pointer. Public/private GitHub import uses request-scoped credentials without git. No background updates or lifecycle effects; failure preserves active source and blocks only affected template.

# Contract

## Acquisition and credentials
The template center exposes Import from GitHub and Check template updates.

It never fetches application packages, npm dependencies, or images.

UI transfer requests have a 24 MiB encoded-body ceiling.

## Review and confirmation
The import dialog separates source entry, directory selection, and final review.

The import flow uses a fixed-height frame bounded by the viewport and its Workbench surface.

The source digest participates in install/update review and applied Runtime identity, so a helper-only edit cannot reuse an obsolete reviewed operation.

## Atomic directory ownership
`<managed-state>/template-sources/source_<opaque-id>/` contains the original files only.

An uncertain commit never deletes a potentially active directory; retry receipts and startup cleanup resolve complete unclaimed directories. Startup removes only unreferenced source directories, never repairs or replaces a corrupt active source.

# Boundaries

Host hooks receive `REDEVEN_TEMPLATE_DIR` for original helper files. [Registry migration](database-schema-migrations.md) owns the contiguous version-4-to-5 metadata migration and atomic rollback.

# Evidence

- `redeven:internal/managedwebservice/template_sources.go` - Source.
- `redeven:internal/portforward/registry/template_sources_test.go` - v4→v5 migration, rollback/stale rejection, no executable projection.

- `redeven:internal/portforward/registry/template_sources_test.go` - Tests.

---
type: Runtime Contract
title: GitHub service template sources
description: Import and manually review original GitHub template directories through Desktop transfer or direct Runtime acquisition.
tags: [architecture, templates, desktop, credentials, persistence]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: upstream owns acquisition and format validation; Redeven owns authenticated import, user review, and the active-directory pointer.
- Outcome: public/private GitHub templates import through Desktop transfer or direct Runtime download without an installed `git` executable.
- Invariants: no background source checks, automatic source updates, dependency installation, script execution, application upgrade, or restart occurs during source import/review. Credentials remain request-scoped.
- Failure boundary: validation or confirmation failure keeps the active source. One missing, corrupt, or unsupported source blocks only that template and its associated operations; there is no old-definition fallback.

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

- `redeven:internal/managedwebservice/template_sources.go` - Owns review, current source resolution, source identity, confirmation, and orphan cleanup.

- `redeven:internal/portforward/registry/template_sources.go` - Stores source metadata and commits the source pointer with its receipt atomically.

- `redeven:internal/portforward/registry/template_sources_test.go` - Verifies the v4-to-v5 edge, rollback, stale confirmation, and absence of executable projections.

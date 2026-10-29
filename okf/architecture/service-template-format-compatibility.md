---
type: Runtime Contract
title: Redeven Service Template format compatibility
tags: [architecture, templates, compatibility, localization]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Released template code owns schemas, historical adapters and current types; Runtime owns execution/authorization. Supported old directories retain bytes, filenames, modes, digest and commit. Adapt only in memory into one executor; no persisted definitions or automatic lifecycle effects. Invalid, ambiguous, future or unsupported formats fail unchanged with explicit recovery.

# Contract

## Identity and version matrix
Current authors use `redeven-service-template.json` with fixed `kind: "redeven.service-template"`, source `schema_version: 4`, author `template_id`, `service_family_id`, positive `revision`, `default_locale`, and `locales`, followed by the full display and execution declaration.

| Entrypoint | Source document | Execution input | Effective execution |
| --- | --- | --- | --- |
| `template.json` | 1 | TemplateSpec 3 | TemplateSpec 7 |
| `template.json` | 2 | TemplateSpec 4, 5, or 6 | TemplateSpec 7 |
| `redeven-service-template.json` | 3 | TemplateSpec 6 | TemplateSpec 7 |
| `redeven-service-template.json` | 4 | TemplateSpec 7 | TemplateSpec 7 |

The branded filename requires the branded document.

## Adaptation and execution ownership
The reader strictly decodes the historical document, applies consecutive data transformations, validates current TemplateSpec and passive resources, then returns the current typed definition. Historical syntax never grants extra privileges.

The npm SDK publishes the corresponding types, schemas, and GitHub acquisition contract; it does not execute services or migrate databases.

# Boundaries

[Git source ownership](managed-service-git-sources.md) defines original-directory storage and review. Reading an older directory or upgrading Redeven never renames `template.json`, rewrites scripts/locales, changes the stored digest or commit, or creates a normalized template row.

[Database migrations](database-schema-migrations.md) retain their exact lineage, shape checks, rollback, and read-only rejection rules.

# Evidence

- `redeven:go.mod` - Pins the formally released upstream reader and data types.

- `redeven:internal/managedwebservice/template_sources.go` - Reads original directories through the published adapter and applies Runtime policy.

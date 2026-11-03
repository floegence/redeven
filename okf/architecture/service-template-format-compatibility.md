---
type: Runtime Contract
title: Redeven Service Template format compatibility
tags: [architecture, templates, compatibility, localization]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Released templates own schemas/adapters/types; Runtime owns execution/authority. Old directories retain bytes/names/modes/digest/commit and adapt in memory to one executor. No stored duplicate definitions/lifecycle effects; invalid or unsupported formats fail unchanged.

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

- `redeven:go.mod` - Source.
- `redeven:internal/managedwebservice/template_sources.go` - Source.

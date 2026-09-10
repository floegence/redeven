---
type: Runtime Contract
title: Redeven Service Template format compatibility
description: Read branded and historical template documents through the released upstream data adapter without rewriting source files.
tags: [architecture, templates, compatibility, localization]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

- Authority: the released `redeven-service-templates/template` package owns schemas, historical data adapters, and current types. Runtime owns authorization and execution.
- Outcome: formally supported old template directories remain usable after a Redeven upgrade, with their original filenames, bytes, modes, digest, and source commit intact.
- Invariants: compatibility operates in memory, feeds one current executor, never persists an adapted execution definition, and never installs, upgrades, or restarts a service by itself.
- Failure boundary: invalid historical shapes, ambiguous entrypoints, incorrect identity, and future formats fail explicitly without altering files. Unsupported formats require a compatible release or author correction.

# Contract

## Identity and version matrix

Current authors use `redeven-service-template.json` with fixed `kind: "redeven.service-template"`, source `schema_version: 3`, author `template_id`, `service_family_id`, positive `revision`, `default_locale`, and `locales`, followed by the full display and execution declaration. The source document, execution specification, author revision, Git commit, and installed application release are distinct identities.

| Entrypoint | Source document | Execution input | Effective execution |
| --- | --- | --- | --- |
| `template.json` | 1 | TemplateSpec 3 | TemplateSpec 6 |
| `template.json` | 2 | TemplateSpec 4, 5, or 6 | TemplateSpec 6 |
| `redeven-service-template.json` | 3 | TemplateSpec 6 | TemplateSpec 6 |

The old filename accepts only the published historical shapes. The branded filename requires the branded document. A directory containing both entrypoints is invalid. Auxiliary files remain relative to the selected directory: `locales/<locale>.json`, `assets/`, and `scripts/`.

An external template can declare any supported locale identifier as its only default language or supply several complete languages. Each declared locale must provide complete presentation and notice content. The renderer uses the requested locale when available, otherwise the template's own default locale. Official catalog publication separately requires all ten Redeven product locales. Historical documents retain their published `en-US` default.

## Adaptation and execution ownership

The reader strictly decodes the historical document, applies consecutive data transformations, validates current TemplateSpec and passive resources, then returns the current typed definition. Redeven applies current permission, workspace, parameter, runtime-profile, and resource policy before execution. Historical syntax never grants extra privileges.

Document 1-to-2 makes the previous default version an explicit recommendation and applies the published retirement of release-discovery filters. Document 2-to-3 supplies branded identity and the historical language default in memory. TemplateSpec 3-to-4 retains the published removal of tag-prefix filtering; 4-to-5 preserves static opening behavior; 5-to-6 maps valid startup-output URL declarations to generic preparation/opening hooks and private output. Retired fields receive those explicit published semantics, rather than being ignored as unknown fields or read using new defaults.

Upstream owns the frozen historical schemas and immutable released fixtures. Its release gate tests every supported source/Spec pair, consecutive and multi-step adaptation, strict failure cases, file identity, and behavioral equivalence of parameters, defaults, opening, lifecycle, resources, and authorization inputs. Previously published adapters and fixtures remain required release inputs. Runtime-owned SQL migrations are a separate owner and cannot substitute for source readers.

The public `validate-template` command checks compatible directories by default; `--current` restricts author validation to the current branded format. Diagnostics identify original document/Spec versions, effective versions, and actionable errors. The npm SDK publishes the corresponding types, schemas, and GitHub acquisition contract; it does not execute services or migrate databases.

# Boundaries

[Git source ownership](managed-service-git-sources.md) defines original-directory storage and review. Reading an older directory or upgrading Redeven never renames `template.json`, rewrites scripts/locales, changes the stored digest or commit, or creates a normalized template row. The canonical resolver materializes the current definition together with the instance's selected application release and configuration only when needed.

This contract does not revive the discarded `portforward_registry_v1` or other rejected database kinds. [Database migrations](database-schema-migrations.md) retain their exact lineage, shape checks, rollback, and read-only rejection rules.

# Evidence

- `redeven:go.mod` - Pins the formally released upstream reader and data types.
- `redeven:internal/managedwebservice/templates.go` - Uses published validation and resolves imported source templates.
- `redeven:internal/managedwebservice/template_sources.go` - Reads original directories through the published adapter and applies Runtime policy.
- `redeven:internal/managedwebservice/template_sources_integration_test.go` - Verifies both acquisition modes, historical hook semantics, restart preservation, and original helper-file access.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Resolves presentation using the template's own language default.

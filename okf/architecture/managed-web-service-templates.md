---
type: Runtime Contract
title: Managed service template publication, acquisition and formats
tags: [architecture, templates, managed-services, localization, supply-chain]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published templates own definitions, formats and passive resources; Redeven validates offline bundles and authorizes imported original directories. Historical syntax adapts in memory to one executor without rewriting stored bytes. Failed acquisition or review preserves active source and grants no lifecycle effects.

# Contract

## Published templates
Published redeven-service-templates owns definitions/releases/locales/icons/notices. Embed digest-verified offline bytes; missing/malformed/future bundles block startup without fallback. recommended_version equals default npm version or each platform image tag. Upstream owns service license/provenance; product notices cover dependency/generic Host runtime. Before Registry/Manager validate manifest/version/digest,unique IDs/families,schema/strict TemplateSpec,deployment/source/platform constraints,ten locales,notices/passive SVG safety/digest.

start_script configures and runs foreground app; optional repeatable after_start_script shares startup deadline and cannot start another service. [Opening](managed-web-service-opening.md) owns recovery. Release upstream first; consume published module without copied assets/local wiring. [Catalog automation](../release/service-template-updates.md) owns discovery/checksum,not database migration.

## GitHub sources
Explicit Import from GitHub/Check updates acquires templates only,never app packages/npm/images. Request-scoped private credentials,no git/background updates/lifecycle effects. UI encoded body<=24MiB. Viewport/Workbench-bounded fixed-height review separates source,directory and confirmation. Source digest participates in install/update review/applied identity,including helper edits.

<managed-state>/template-sources/source_<opaque-id>/ retains original files only. Uncertain commit never deletes possibly active directory; retry receipts/startup cleanup resolve complete unclaimed directories. Startup removes unreferenced sources only,never repairs/replaces corrupt active source. Hooks get REDEVEN_TEMPLATE_DIR for originals. [Registry migration](database-schema-migrations.md) owns atomic v4→v5 metadata/rollback.

## Formats
Authors use redeven-service-template.json,kind:redeven.service-template,schema_version4,template_id,service_family_id,positive revision,default_locale/locales and complete display/execution declarations. Branded filename requires branded document. Supported source→input→effective matrix:
- template.json v1→TemplateSpec3→7.
- template.json v2→TemplateSpec4/5/6→7.
- branded v3→TemplateSpec6→7;v4→7→7.

Strict decode,consecutive in-memory transformations,current validation/passive-resource checks feed one executor. Old syntax grants no privilege. SDK publishes types/schemas/acquisition,never execution/migration. Reading old directories/upgrading cannot rename files,rewrite scripts/locales,change modes/digest/commit or add normalized rows.

# Boundaries

Templates/catalogs never own Registry lifecycle,select user releases or bypass permission/resource checks. Do not copy upstream adapters,fingerprints,legacy paths,process/volume rules,locales/assets. Original source identity and database lineage remain authoritative; unknown format/migration drift fails unchanged.

# Evidence

- `redeven:go.mod` - Source.
- `redeven:internal/managedwebservice/types.go` - Source.

- `redeven:internal/managedwebservice/template_sources.go` - Source.
- `redeven:internal/portforward/registry/template_sources_test.go` - v4→v5 migration, rollback/stale rejection, no executable projection.

---
type: Runtime Contract
title: Managed service template publication, acquisition and formats
tags: [architecture, templates, managed-services, localization, supply-chain]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Published templates own definitions, formats and passive resources; Redeven validates offline bundles and authorizes imported original directories. Strict decode,consecutive in-memory transformations,current validation/passive-resource checks feed one executor.

# Contract

## Published templates
Published redeven-service-templates owns definitions/releases/locales/icons/notices. Embed digest-verified offline bytes; missing/malformed/future bundles block startup without fallback. recommended_version equals default npm version or each platform image tag. Upstream owns service license/provenance; product notices cover dependency/generic Host runtime. Before Registry/Manager validate manifest/version/digest,unique IDs/families,schema/strict TemplateSpec,deployment/source/platform constraints,ten locales,notices/passive SVG safety/digest.

start_script configures and runs foreground app; optional repeatable after_start_script shares startup deadline and cannot start another service. [Opening](managed-web-service-opening.md) owns recovery. Release upstream first; consume published module without copied assets/local wiring. [Catalog automation](../release/service-template-updates.md) owns discovery/checksum,not database migration.

Marketplace discovery, acquisition, browsing and qualification follow [the service template marketplace contract](service-template-marketplace.md).

## Instance source versions
`<managed-state>/template-sources/source_<opaque-id>/` retains original files. Registry schema 8 stores source-version metadata and per-instance bindings, not copied executable specifications. Updating the library does not update instances. New instances bind the accepted digest; retained originals survive restart and library updates. The v6-to-v7 migration marks historical bindings unverified and preserves user rows. Execution requires matching applied runtime evidence; passive settings permit explicit source repair without guessing missing history.

Settings expose current/available source versions. An explicit source review preserves instance overrides and installed application release, includes required notices, and binds the source digest to reconfiguration preflight. Applying requires a stopped instance. Source binding and configuration revision commit together; the existing journal carries old/target digests for container/Compose rollback and interrupted-operation recovery. Host hooks take effect on their next matching lifecycle action. Garbage collection protects current, bound and journal/active-operation source versions. Missing bindings or modified originals block execution. Hooks receive `REDEVEN_TEMPLATE_DIR` for the retained originals.

Personal derivation, immutable base retention and editor restrictions are defined in [personal service templates](personal-service-templates.md).

## Formats
Authors use redeven-service-template.json,kind:redeven.service-template,schema_version4,template_id,service_family_id,positive revision,default_locale/locales and complete display/execution declarations. Branded filename requires branded document. Supported source→input→effective matrix:
- template.json v1→TemplateSpec3→7.
- template.json v2→TemplateSpec4/5/6→7.
- branded v3→TemplateSpec6→7;v4→7→7.

Old syntax grants no privilege. SDK publishes types/schemas/acquisition,never execution/migration. Reading old directories/upgrading cannot rename files,rewrite scripts/locales,change modes/digest/commit or add normalized rows.

# Boundaries

Templates/catalogs never own Registry lifecycle,select user releases or bypass permission/resource checks. Do not copy upstream adapters,fingerprints,legacy paths,process/volume rules,locales/assets. Original source identity and database lineage remain authoritative; unknown format/migration drift fails unchanged.

# Evidence

- `redeven:go.mod` - published package boundary.
- `redeven:internal/portforward/registry/template_versions_test.go` - atomic migration and source-version retention.
- `redeven:internal/managedwebservice/template_source_profile_test.go` - complete original-byte and mode authorization for the reserved desktop profile.

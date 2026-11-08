---
type: Runtime Contract
title: Managed service template publication, acquisition and formats
tags: [architecture, templates, managed-services, localization, supply-chain]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Published templates own definitions, formats and passive resources; Redeven validates offline bundles and authorizes imported original directories. Strict decode,consecutive in-memory transformations,current validation/passive-resource checks feed one executor.

# Contract

## Published templates
Published redeven-service-templates owns definitions/releases/locales/icons/notices. Embed digest-verified offline bytes; missing/malformed/future bundles block startup without fallback. recommended_version equals default npm version or each platform image tag. Upstream owns service license/provenance; product notices cover dependency/generic Host runtime. Before Registry/Manager validate manifest/version/digest,unique IDs/families,schema/strict TemplateSpec,deployment/source/platform constraints,ten locales,notices/passive SVG safety/digest.

start_script configures and runs foreground app; optional repeatable after_start_script shares startup deadline and cannot start another service. [Opening](managed-web-service-opening.md) owns recovery. Release upstream first; consume published module without copied assets/local wiring. [Catalog automation](../release/service-template-updates.md) owns discovery/checksum,not database migration.

## Discovery and acquisition
The existing `redeven-plugin-market` Worker owns passive template discovery; no separate registry or repository is required. Public GitHub repositories opt in with `redeven-service-template`. The published SDK discovers either a root template or direct `templates/<name>` entries. The default branch is the tracking channel; directory changes require a new positive revision. The market rejects changed bytes at the same revision, records confirmed source unavailability and retains the last verified evidence after observation failures. Classification is presentation, not execution trust.

`GET /managed-web-service-templates/market-catalog` returns local cache with read permission; explicit/open-discovery refresh uses POST and full permission. The product reads a complete ordered generation, validates identity/presentation, rejects redirects, regressions and incomplete pages, then atomically replaces its cache. Failure preserves prior evidence. Environment changes fence UI responses. Official entries remain the embedded validated catalog; remote discovery cannot replace them.

Import/check-source and market deployment use the same immutable, owner-scoped 15-minute review. The market selection pins numeric repository ID, commit SHA and directory digest through Desktop transfer or remote acquisition. Runtime independently verifies originals with the published reader. Private tokens remain request-scoped. Neither discovery, inspection, file review nor install preparation saves executable sources or runs lifecycle actions. A market deployment continues directly from source review to the existing install form; the final request atomically commits source acceptance, source binding, service, forward and operation receipt. Receipt reconciliation never blindly replays an uncertain install.

## Instance source versions
`<managed-state>/template-sources/source_<opaque-id>/` retains original files. Registry schema 7 stores source-version metadata and per-instance bindings, not copied executable specifications. Updating the library does not update instances. New instances bind the accepted digest; retained originals survive restart and library updates. The v6-to-v7 migration marks historical bindings unverified and preserves user rows. Execution requires matching applied runtime evidence; passive settings permit explicit source repair without guessing missing history.

Settings expose current/available source versions. An explicit source review preserves instance overrides and installed application release, includes required notices, and binds the source digest to reconfiguration preflight. Applying requires a stopped instance. Source binding and configuration revision commit together; the existing journal carries old/target digests for container/Compose rollback and interrupted-operation recovery. Host hooks take effect on their next matching lifecycle action. Garbage collection protects current, bound and journal/active-operation source versions. Missing bindings or modified originals block execution. Hooks receive `REDEVEN_TEMPLATE_DIR` for the retained originals.

## Formats
Authors use redeven-service-template.json,kind:redeven.service-template,schema_version4,template_id,service_family_id,positive revision,default_locale/locales and complete display/execution declarations. Branded filename requires branded document. Supported source→input→effective matrix:
- template.json v1→TemplateSpec3→7.
- template.json v2→TemplateSpec4/5/6→7.
- branded v3→TemplateSpec6→7;v4→7→7.

Old syntax grants no privilege. SDK publishes types/schemas/acquisition,never execution/migration. Reading old directories/upgrading cannot rename files,rewrite scripts/locales,change modes/digest/commit or add normalized rows.

# Boundaries

Templates/catalogs never own Registry lifecycle,select user releases or bypass permission/resource checks. Do not copy upstream adapters,fingerprints,legacy paths,process/volume rules,locales/assets. Original source identity and database lineage remain authoritative; unknown format/migration drift fails unchanged.

# Evidence

- `redeven:go.mod` - Source.

- `redeven:internal/templatemarket/service_test.go` - complete cache generations, identity validation, cancellation and stale retention.
- `redeven:internal/portforward/registry/template_versions_test.go` - atomic migration and install rollback.
- `redeven:internal/managedwebservice/template_market_acceptance_test.go` - exact review, pinning, commit, rollback and recovery.
- `redeven:internal/managedwebservice/template_market_native_test.go` - opt-in Host, Docker and Compose deployment/update/cleanup.
- `redeven:internal/envapp/ui_src/src/ui/pages/serviceTemplateMarket.test.ts` - refresh failure and environment isolation.

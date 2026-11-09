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
The existing `redeven-plugin-market` Worker owns passive template discovery; no separate registry or repository is required. Public GitHub repositories opt in with `redeven-service-template`. The published SDK discovers either a root template or direct `templates/<name>` entries. The default branch is the tracking channel; directory changes require a new positive revision. The market rejects changed bytes at the same revision, records confirmed source unavailability and retains the last verified evidence after observation failures. Classification is presentation, not execution trust. The reserved interactive-desktop profile requires every original file and its non-executable mode to match the published official package manifest; the runtime issues the capability only during exact-byte review and retains it with immutable source-version metadata. Reopening verifies the full directory digest before restoring that capability, so future package releases do not revoke previously reviewed instances. New privileged definitions require a reviewed package release, regardless of their market classification.

`GET /managed-web-service-templates/market-catalog` returns local cache with read permission; explicit/open-discovery refresh uses POST and full permission. The product reads a complete ordered generation, validates identity/presentation, rejects redirects, regressions and incomplete pages, then atomically replaces its cache. Failure preserves prior evidence. Environment changes fence UI responses. Discovery presents official and community entries from the same verified remote catalog and uses the same pinned review-to-deployment flow for both. Discovery is the default entry and initially includes every deployment type. Official, Community and My templates are explicit source views. My templates contains accepted Git sources and user-created templates; embedded definitions are excluded from browsing/new deployment entry points. Embedded published bytes remain solely for legacy instance resolution and exact-source runtime-profile authorization. No instance or source binding is rewritten. Remote discovery never overwrites a builtin template or silently upgrades an installed instance.

Import/check-source and market deployment use the same immutable, owner-scoped 15-minute review. The market selection pins numeric repository ID, commit SHA and directory digest through Desktop transfer or remote acquisition. Runtime independently verifies originals with the published reader. Private tokens remain request-scoped. Neither discovery, inspection, file review nor install preparation saves executable sources or runs lifecycle actions. A market deployment continues directly from source review to the existing install form; the final request atomically commits source acceptance, source binding, service, forward and operation receipt. Receipt reconciliation never blindly replays an uncertain install.

## Marketplace browsing
Redeven consumes the published metadata without adding a second registry, GitHub repository, local format or name-based taxonomy. The current categories are the authoritative deployment kinds: All types, Host, Container and Docker Compose. Semantic categories (for example AI or databases) require an explicit upstream format/publication contract before product adoption; they are not inferred from names.

Search combines whitespace-delimited terms, normalizes Unicode width/case, and covers displayed identity, all published localization names/descriptions, document identity, repository/path and default release. Source and deployment facets compose with search; counts reflect the current source/search before deployment filtering. Empty results offer a reset to complete discovery. Refresh replaces passive evidence without clearing the query, category or requested identity. Environment ownership fences pending responses; stale cache remains visible with an explicit status and retry action. Saving or importing a template opens My templates with clear filters.

The source navigation, search/actions and deployment facets occupy separate rows. Categories wrap at narrow widths, names wrap, descriptions use two lines, and independent list/detail scrolling keeps deployment reachable on desktop. Remote details show only published evidence (deployment, revision, release, platforms, immutable source link); access mode and execution settings appear after review, never as unexplained empty placeholders. Source grouping uses Official/Community instead of labeling every remote entry GitHub. Shared Floe controls retain keyboard/focus behavior; this layout is a product adapter.

Acceptance covers default discovery of all four official entries without bundled duplicates, source/search/type intersections and reset, library creation/import, source-review ownership and deployment admission, cache/environment fences, complete localization, 320–1440 CSS-pixel layouts, wrapping categories and non-overlapping controls. Legacy instance lifecycle and upstream capability authorization remain covered by Runtime tests.

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

- `redeven:go.mod` - Source.

- `redeven:internal/templatemarket/service_test.go` - complete cache generations, identity validation, cancellation and stale retention.
- `redeven:internal/portforward/registry/template_versions_test.go` - atomic migration and install rollback.
- `redeven:internal/managedwebservice/template_market_acceptance_test.go` - exact review, pinning, commit, rollback and recovery.
- `redeven:internal/managedwebservice/template_official_acceptance_test.go` - opt-in production discovery, exact source review and real installation/open/stop/start/uninstall for all official templates; browser reload/reopen and screenshots via `checkOfficialTemplatePage.mjs`; desktop qualification requires rendered desktop pixels or decoded video rather than an empty canvas. Catalog v0.8.1 corrects the old Webtop recommendations with reviewed multiarchitecture artifacts (template revision 6).
Live qualification: set `REDEVEN_OFFICIAL_TEMPLATE_TEST=1`, `REDEVEN_OFFICIAL_TEMPLATE_NATIVE=1`, and an existing `REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE` directory, then run `GOWORK=off go test ./internal/managedwebservice -run ^TestOfficialTemplateMarketLifecycle$ -timeout 60m -count=1 -v`. Install the pinned UI dependencies for the real Chromium opening check. Optional `GITHUB_TOKEN` is request-scoped. This exercises actual packages and Docker images, requires Docker, and removes only newly allocated service resources. Without the native flag it verifies discovery, immutable acquisition, review and preparation without installing applications.

- `redeven:internal/managedwebservice/template_source_profile_test.go` - reserved-profile authorization requires the complete published original, including file modes.
- `redeven:internal/managedwebservice/template_market_native_test.go` - opt-in Host, Docker and Compose deployment/update/cleanup.
- `redeven:internal/envapp/ui_src/src/ui/pages/serviceTemplateMarket.test.ts` - refresh failure and environment isolation.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - market-first browsing, builtin retirement, composed search/facets and immutable review-to-install handoff.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.browser.test.tsx` - toolbar separation, localized responsive geometry, keyboard selection and persistent deployment actions.

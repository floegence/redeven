---
type: Runtime Contract
title: Managed Web Service Templates
description: Consume one signed-off versioned service catalog while keeping template content outside Redeven.
tags: [architecture, templates, managed-services, localization, supply-chain]
timestamp: 2026-09-02T00:00:00Z
---
# Summary

- Authority: `github.com/floegence/redeven-service-templates` owns built-in template identity, specification, releases, localization, icons, and service-specific third-party notices.
- Outcome: Redeven embeds one immutable, reproducible, digest-verified bundle that works offline and maps into generic Template responses.
- Invariants: all ten published locales are explicit, assets are passive SVG bytes, platform artifacts are exact, and catalog failure prevents Runtime startup.
- Failure boundary: missing, malformed, mismatched, unsupported, or future bundle content is rejected without falling back to local definitions.

# Contract

## Published bundle

The template repository publishes a versioned Go module. Each template lives at `templates/<template-id>/template.json`, with locale files under `locales/<locale>.json` and passive assets under `assets/`. Its reproducible schema-v1 bundle includes:

- template and service-family identity, revision, deployment kind, and TemplateSpec v3;
- npm or OCI source, exact reviewed release identity, platform matrix, access mode, resource requirements, and discovery policy;
- localized name, description, notices, source declaration, and icon metadata for every shipped locale.

The Go package exports only read-only bundle bytes, module version, manifest, and SHA-256. It contains no driver or migration code. Service-specific license and provenance statements remain in that repository; Redeven's root notice declares only the module dependency and generic Host runtime it downloads.

## Redeven mapping

Catalog loading completes before Registry and Manager startup. Validation covers the outer bundle, manifest, module version, canonical digest, unique IDs and families, schema versions, strict TemplateSpec decoding, supported deployment kinds, HTTPS sources, OCI platform digests, locale completeness, notice references, and SVG digest and safety constraints.

The mapper does not reinterpret application commands or manufacture service presentation. API responses carry localized bundle content and verified icon resource bytes; they no longer expose `localization_key` or a fixed brand enum. Renderer selects the requested locale with `en-US` fallback inside the already verified bundle and renders SVG only as an image data resource, never as arbitrary HTML.

Built-in installed state is matched by exact template ID. Custom templates remain Registry-owned user content, use their entered name and description, and are marked as user-configured sources. Both built-in and custom templates enter the same generic Host, Container, or Compose lifecycle after validation.

## Change contract

A catalog change is released upstream first, then Redeven upgrades to that published module version without `replace`, `go.work`, local paths, or copied assets. Bundle schema evolution belongs to the template module; Redeven must explicitly adopt and validate a new schema before it can load it. Runtime persistence migration remains a separate Redeven-owned concern and cannot be hidden in catalog decoding.

# Boundaries

Redeven does not keep a compatibility directory, template fingerprints, retired paths, container names, data-volume markers, process rules, service-specific localizations, or application assets. The catalog does not execute services, own Registry records, choose user releases silently, or bypass Redeven permission and resource policies.

# Evidence

- `redeven:go.mod` - Pins the released catalog module without local dependency wiring.
- `redeven:internal/managedwebservice/builtin_templates.go` - Verifies and maps bundle records into generic templates.
- `redeven:internal/managedwebservice/types.go` - Defines current TemplateSpec, localization, icon, and lifecycle API shapes.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.tsx` - Presents localized verified content through the common catalog UI.
- `redeven:scripts/check_managed_service_catalog_boundary.mjs` - Enforces repository ownership of service-specific content.

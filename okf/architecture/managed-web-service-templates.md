---
type: Runtime Contract
title: Managed Web Service Templates
description: Consume one signed-off versioned service catalog whose release is a recommendation, not a user-version restriction.
tags: [architecture, templates, managed-services, localization, supply-chain]
timestamp: 2026-09-02T00:00:00Z
---
# Summary

- Authority: `github.com/floegence/redeven-service-templates` owns built-in template identity, specification, releases, localization, icons, and service-specific third-party notices.
- Outcome: Redeven embeds one immutable, reproducible, digest-verified bundle that works offline and maps its declared release to the default and recommended installation choice.
- Invariants: recommendation never limits source versions or changes an installed exact release; all ten published locales are explicit, assets are passive SVG bytes, platform artifacts are exact, and catalog failure prevents Runtime startup.
- Failure boundary: missing, malformed, mismatched, unsupported, or future bundle content is rejected without falling back to local definitions.

# Contract

## Published bundle

The template repository publishes a versioned Go module. Each template lives at `templates/<template-id>/template.json`, with locale files under `locales/<locale>.json` and passive assets under `assets/`. Its reproducible schema-v2 bundle includes:

- template and service-family identity, revision, deployment kind, and TemplateSpec v5;
- `recommended_version`, npm or OCI source, exact default platform artifact, platform matrix, access mode, and resource requirements;
- localized name, description, notices, source declaration, and icon metadata for every shipped locale.

`recommended_version` must equal the default npm package version or every platform's default image tag. It means only the version Redeven recommends and installs when the user makes no version choice. It is not a whitelist, minimum, automatic-update target, or authority to replace an installed release. Discovery declarations identify a source only; the bundle cannot block preview, deprecated, special, or non-SemVer releases.

The Go package exports only read-only bundle bytes, module version, manifest, and SHA-256. It contains no driver or migration code. Service-specific license and provenance statements remain in that repository; Redeven's root notice declares only the module dependency and generic Host runtime it downloads.

## Redeven mapping

Catalog loading completes before Registry and Manager startup. Validation covers the outer bundle, manifest, module version, canonical digest, unique IDs and families, schema versions, strict TemplateSpec decoding, supported deployment kinds, HTTPS sources, OCI platform digests, locale completeness, notice references, and SVG digest and safety constraints.

The mapper does not reinterpret application commands or manufacture service presentation. API responses carry localized bundle content and verified icon resource bytes; they no longer expose `localization_key` or a fixed brand enum. Renderer selects the requested locale with `en-US` fallback inside the already verified bundle and renders SVG only as an image data resource, never as arbitrary HTML.

TemplateSpec v5 lets a Host choose exactly one opening contract: the existing static endpoint path, or a declared `startup_output_url` identified by a strict line prefix. The template owns only that declaration. Redeven owns process output capture, URL validation, private storage, Forward resolution, and opening authorization; it does not infer an application from its output or provide a fallback when the declared contract is not met.

Built-in installed state is matched by exact template ID. Template responses expose `recommended_release`, `release_source`, and the exact default artifact, never an ambiguous `version`. The default workspace path is presentation-only and is not created while browsing, saving, copying, or checking versions. Custom templates remain Registry-owned user content, use their entered name and description, derive their default release from the exact npm or image reference, and are marked as user-configured sources. Both built-in and custom templates enter the same generic Host, Container, or Compose lifecycle after validation.

## Change contract

A catalog change is released upstream first, then Redeven upgrades to that published module version without `replace`, `go.work`, local paths, or copied assets. Bundle schema evolution belongs to the template module; Redeven must explicitly adopt and validate a new schema before it can load it. Runtime persistence migration remains a separate Redeven-owned concern and cannot be hidden in catalog decoding.

# Boundaries

Redeven does not keep a compatibility directory, template fingerprints, retired paths, container names, data-volume markers, process rules, service-specific localizations, or application assets. The catalog does not execute services, own Registry records, choose user releases silently, or bypass Redeven permission and resource policies.

# Evidence

- `redeven:go.mod` - Pins catalog module v0.3.0 without local dependency wiring.
- `redeven:internal/managedwebservice/builtin_templates.go` - Verifies and maps bundle records into generic templates.
- `redeven:internal/managedwebservice/types.go` - Defines current TemplateSpec, localization, icon, and lifecycle API shapes.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.tsx` - Presents localized verified content through the common catalog UI.
- `redeven:scripts/check_managed_service_catalog_boundary.mjs` - Enforces repository ownership of service-specific content.

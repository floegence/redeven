---
type: Runtime Contract
title: Managed Web Service Templates
description: Consume one signed-off versioned service catalog whose release is a recommendation, not a user-version restriction.
tags: [architecture, templates, managed-services, localization, supply-chain]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: `github.com/floegence/redeven-service-templates` owns built-in template identity, specification, releases, localization, icons, and service-specific third-party notices.
- Outcome: Redeven embeds one immutable, reproducible, digest-verified bundle that works offline and maps its declared release to the default and recommended installation choice.
- Invariants: recommendation never limits source versions or changes an installed exact release; all ten published locales are explicit, assets are passive SVG bytes, platform artifacts are exact, and catalog failure prevents Runtime startup.
- Failure boundary: missing, malformed, mismatched, unsupported, or future bundle content is rejected without falling back to local definitions.

# Contract

## Published bundle
The template repository publishes a versioned Go module.

`recommended_version` must equal the default npm package version or every platform's default image tag.

Service-specific license and provenance statements remain in that repository; Redeven's root notice declares only the module dependency and generic Host runtime it downloads.

## Redeven mapping
Catalog loading completes before Registry and Manager startup. Validation covers the outer bundle, manifest, module version, canonical digest, unique IDs and families, schema versions, strict TemplateSpec decoding, supported deployment kinds, HTTPS sources, OCI platform digests, locale completeness, notice references, and SVG digest and safety constraints.

[Managed opening](managed-web-service-opening.md) owns launch preparation, private persistence and recovery.

## Host hooks and output
`start_script` prepares application configuration and executes the foreground application. `after_start_script` is an optional, safely repeatable preparation hook using the existing startup deadline; it must not start a second service.

[Git sources](managed-service-git-sources.md) own original-directory persistence, temporary acquisition credentials, and manual source review.

## Change contract
A catalog change is released upstream first, then Redeven upgrades to that published module version without `replace`, `go.work`, local paths, or copied assets. The [automated catalog update contract](../release/service-template-updates.md) owns scheduled discovery, source integration, checksums, and failure recovery. Runtime persistence migration remains a separate Redeven-owned concern and cannot be hidden in catalog decoding.

# Boundaries

Redeven does not copy upstream compatibility adapters or service-specific template fingerprints, retired paths, container names, data-volume markers, process rules, service-specific localizations, or application assets. The catalog does not execute services, own Registry records, choose user releases silently, or bypass Redeven permission and resource policies.

# Evidence

- `redeven:go.mod` - Pins the released catalog module without local dependency wiring.

- `redeven:internal/managedwebservice/builtin_templates.go` - Verifies and maps bundle records into generic templates.

- `redeven:internal/managedwebservice/types.go` - Aliases the published TemplateSpec, localization, and icon types and defines product lifecycle responses.

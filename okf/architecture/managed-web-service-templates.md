---
type: Runtime Contract
title: Managed Web Service Templates
description: Consume one signed-off versioned service catalog whose release is a recommendation, not a user-version restriction.
tags: [architecture, templates, managed-services, localization, supply-chain]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

The released `redeven-service-templates` module owns built-in identity, specifications, releases, localization, icons and service-specific notices. Redeven embeds a reproducible digest-verified offline bundle. Recommendations set defaults, never constrain source choices or replace installed releases. Malformed, missing, mismatched or future content blocks startup without local-definition fallback.

# Contract

- `recommended_version` equals the default npm version or every platform's default image tag. Upstream owns service licenses/provenance; Redeven notices cover the dependency and generic Host runtime only.
- Before Registry/Manager startup, validate bundle/manifest/version/digest, unique IDs/families, schema and strict TemplateSpec, deployment/source/platform constraints, all ten locales, notices and passive SVG digest/safety.
- `start_script` prepares configuration and executes the foreground app. Optional repeatable `after_start_script` uses the startup deadline and cannot start another service. [Opening](managed-web-service-opening.md) owns launch recovery; [Git sources](managed-service-git-sources.md) owns original directories/temporary credentials/review.
- Release upstream changes first, then consume the published module without local wiring or copied assets. [Catalog automation](../release/service-template-updates.md) owns discovery/checksums; product database migration remains separate.

# Boundaries

Do not copy upstream adapters, fingerprints, legacy paths, process/volume rules, localization or assets. Catalogs neither execute services nor own Registry records, silently choose user releases or bypass product permission/resource checks.

# Evidence

- `redeven:go.mod` - Pins the released catalog module without local dependency wiring.

- `redeven:internal/managedwebservice/builtin_templates.go` - Verifies and maps bundle records into generic templates.

- `redeven:internal/managedwebservice/types.go` - Aliases the published TemplateSpec, localization, and icon types and defines product lifecycle responses.

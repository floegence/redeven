---
type: Runtime Contract
title: Managed Web Service Templates
description: Consume one signed-off versioned service catalog whose release is a recommendation, not a user-version restriction.
tags: [architecture, templates, managed-services, localization, supply-chain]
timestamp: 2026-09-07T00:00:00Z
---
# Summary

- Authority: `github.com/floegence/redeven-service-templates` owns built-in template identity, specification, releases, localization, icons, and service-specific third-party notices.
- Outcome: Redeven embeds one immutable, reproducible, digest-verified bundle that works offline and maps its declared release to the default and recommended installation choice.
- Invariants: recommendation never limits source versions or changes an installed exact release; all ten published locales are explicit, assets are passive SVG bytes, platform artifacts are exact, and catalog failure prevents Runtime startup.
- Failure boundary: missing, malformed, mismatched, unsupported, or future bundle content is rejected without falling back to local definitions.

# Contract

## Published bundle

The template repository publishes a versioned Go module. Each template lives at `templates/<template-id>/template.json`, with locale files under `locales/<locale>.json` and passive assets under `assets/`. Its reproducible schema-v2 bundle includes:

- template and service-family identity, revision, deployment kind, and TemplateSpec v6;
- `recommended_version`, npm or OCI source, exact default platform artifact, platform matrix, access mode, and resource requirements;
- localized name, description, notices, source declaration, and icon metadata for every shipped locale.

`recommended_version` must equal the default npm package version or every platform's default image tag. It means only the version Redeven recommends and installs when the user makes no version choice. It is not a whitelist, minimum, automatic-update target, or authority to replace an installed release. Discovery declarations identify a source only; the bundle cannot block preview, deprecated, special, or non-SemVer releases.

The Go package exports only read-only bundle bytes, module version, manifest, and SHA-256. It contains no driver or migration code. Service-specific license and provenance statements remain in that repository; Redeven's root notice declares only the module dependency and generic Host runtime it downloads.

## Redeven mapping

Catalog loading completes before Registry and Manager startup. Validation covers the outer bundle, manifest, module version, canonical digest, unique IDs and families, schema versions, strict TemplateSpec decoding, supported deployment kinds, HTTPS sources, OCI platform digests, locale completeness, notice references, and SVG digest and safety constraints.

The mapper does not reinterpret application commands or manufacture service presentation. API responses carry localized bundle content and verified icon resource bytes; they no longer expose `localization_key` or a fixed brand enum. Renderer selects the requested locale with `en-US` fallback inside the already verified bundle and renders SVG only as an image data resource, never as arbitrary HTML.

TemplateSpec v6 defines the generic Host hook contract below. Container and Compose retain their existing launch and opening behavior and acquire no host-script execution permission.

## Host hooks and output

`start_script` prepares application configuration and executes the foreground application. `after_start_script` is an optional, safely repeatable preparation hook using the existing startup deadline; it must not start a second service. `open_script` is an optional URL resolver with a maximum execution time of 10 seconds and a stdout limit of 16 KiB containing exactly one URL line. `stop_script` remains a before-stop hook, followed by Redeven's verified group termination. Templates without new hooks use the declared endpoint scheme, port, and path.

Each real launch creates a mode-0700 private directory exposed as `REDEVEN_SERVICE_RUN_DIR`. It belongs to the service, launch nonce, applied digest, and stable native identity. Hooks use the same user, authorized workspace, parameters, and secret injection as the existing Host contract. Installation-only npm Registry credentials remain excluded. Redeven stores opening metadata, never executable template snapshots.

`output_mode` defaults to `discard`, directly connecting application standard streams to `/dev/null`. `private_file` appends stdout and stderr directly to a mode-0600 file whose path is exposed as `REDEVEN_SERVICE_OUTPUT_FILE`. Templates may parse that output to persist private opening information; applications with configuration or state-file support should read those sources directly. Every output prefix and application-specific parsing rule belongs to the template.

Private output is truncated in place after successful opening persistence. While Runtime is online, a 30-second maintenance check truncates files above 8 MiB without replacing their inode or live descriptor. Offline growth is an explicit limitation. These files are startup scratch space, not a log archive; deleting an open filename is not a substitute for truncation. No output collector or additional resident process is introduced.

Hook results can contain credentials and never enter ordinary logs, operation output, or audit. Diagnostics contain only hook phase, duration, exit code, and safe error codes. The returned URL must use the declared HTTP/HTTPS scheme, a loopback host, the service's exact port, and a valid relative opening path after conversion. Hook code cannot select an external target or bypass the existing Forward authorization and proxy authentication. Hook failure changes opening availability without stopping a running service. Lifecycle and legacy-instance recovery are defined in the [independent Host lifecycle](independent-host-services.md).

Built-in installed state is matched by exact template ID. Template responses expose `recommended_release`, `release_source`, and the exact default artifact, never an ambiguous `version`. The default workspace path is presentation-only and is not created while browsing, saving, copying, or checking versions. Custom templates remain Registry-owned user content, use their entered name and description, derive their default release from the exact npm or image reference, and are marked as user-configured sources. Both built-in and custom templates enter the same generic Host, Container, or Compose lifecycle after validation.

## Change contract

A catalog change is released upstream first, then Redeven upgrades to that published module version without `replace`, `go.work`, local paths, or copied assets. The [automated catalog update contract](../release/service-template-updates.md) owns scheduled discovery, source integration, checksums, and failure recovery. Catalog updates reach users through the next normal Redeven release and do not change installed release identities. Bundle schema evolution belongs to the template module; Redeven must explicitly adopt and validate a new schema before it can load it. Runtime persistence migration remains a separate Redeven-owned concern and cannot be hidden in catalog decoding.

# Boundaries

Redeven does not keep a compatibility directory, template fingerprints, retired paths, container names, data-volume markers, process rules, service-specific localizations, or application assets. The catalog does not execute services, own Registry records, choose user releases silently, or bypass Redeven permission and resource policies.

# Evidence

- `redeven:go.mod` - Pins the released catalog module without local dependency wiring.
- `redeven:internal/managedwebservice/builtin_templates.go` - Verifies and maps bundle records into generic templates.
- `redeven:internal/managedwebservice/types.go` - Defines current TemplateSpec, localization, icon, and lifecycle API shapes.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.tsx` - Presents localized verified content through the common catalog UI.
- `redeven:scripts/check_managed_service_catalog_boundary.mjs` - Enforces repository ownership of service-specific content.

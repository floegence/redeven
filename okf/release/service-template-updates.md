---
type: Release Contract
title: Automated service-template catalog updates
description: Follow verified upstream catalog tags through isolated source updates and the exact-main integration gate.
tags: [release, automation, templates, supply-chain]
timestamp: 2026-09-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The template repository owns recommendation discovery and immutable catalog releases.
Redeven's daily and manually dispatched watcher owns adoption of the published Go
module into source `main`. A successful update pins verified checksums, regenerates
notices and knowledge artifacts, and passes the normal final integration gate.
Failures preserve the last published main tip; a failed or uncertain push requires
remote-ref inspection before another attempt.

# Contract

## Upstream publication
The template repository's configured release sources select the official npm `latest` dist-tag and reviewed canonical OCI tags. The catalog is published with a new immutable module tag after isolated generation, Registry preflight, generated-contract verification, SDK acquisition tests, and all upstream Go tests, including the complete frozen historical-format fixtures.

## Published dependency adoption
Redeven queries only `github.com/floegence/redeven-service-templates` through `https://proxy.golang.org` and `sum.golang.org`. The chosen module and go.mod hashes must match the exact go.sum entries.

Maintained knowledge describes stable boundaries and does not need a prose rewrite for each version number.

## Main integration and recovery
Immediately before integration the watcher fetches remote main and compares it with the recorded base.

A failed gate can leave a candidate on the ephemeral runner's local main, but it is never published. Each run removes only its own temporary worktree and private branch.

# Boundaries

The schema/acquisition npm SDK is independently pinned to a formal upstream release tarball and SHA-512 in Desktop and Env App lockfiles.

They are checked and updated only through the user-driven [Git source review](../architecture/managed-service-git-sources.md) flow, never by repository scheduling or application startup.

The [Managed Service release contract](../architecture/managed-service-release-discovery.md) owns installed release identity and user-selected upgrades; catalog adoption does not rebuild, restart, or upgrade installed instances.

# Evidence

- `redeven:.github/workflows/update-service-template-dependency.yml` - Schedules isolated updates, prepares dependencies, and constrains generated output.

- `redeven:scripts/update_service_template_dependency.mjs` - Enforces public module discovery, checksums, exact sums, no-op, and failure restoration.

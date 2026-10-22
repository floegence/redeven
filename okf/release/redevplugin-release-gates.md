---
type: Release Contract
title: ReDevPlugin release artifact gate
description: Verify the released ReDevPlugin publication, native runtime evidence, packaging inventory, and exact collector inputs.
tags: [release, redevplugin, artifacts, signing]
timestamp: 2026-10-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven admits only the coordinated ReDevPlugin release published through its exact manifest, registry readbacks, native runtime evidence, and closed installer inventory. Every artifact is bound to the release tag, source commit, target, digest, signature identity, and package receipt before publication; partial, mutable, Windows, or target-mismatched inputs fail closed.

# Contract

Redeven consumes only the coordinated ReDevPlugin `v3.0.36` release manifest. Local-wiring scans cover maintained source, scripts, and build configuration while excluding generated `dist` and `node_modules` trees; a scanner error fails closed instead of being treated as no match.

Unknown activation links, unsupported architectures, or missing native runtime evidence are fatal.

# Boundaries

This concept owns ReDevPlugin release provenance and package assembly. Unreleased upstream bytes, local sibling wiring, mutable source identities, partial evidence, and Windows artifacts cannot become formal release inputs.

# Evidence

- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies the exact upstream publication and registry readbacks.

- `redeven:scripts/stage_redevplugin_release_artifacts.sh:1` - Builds and signs each native Linux or Darwin runtime from the exact published crate graph.

- `redeven:scripts/redevplugin_release_contract.test.mjs` - Verifies linked CLI execution, manifest rejection, and bound runtime evidence.

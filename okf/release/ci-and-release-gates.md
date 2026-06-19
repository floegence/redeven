---
type: Release Contract
title: CI and release gates
description: Redeven release confidence comes from shell checks, OKF validation, UI checks, Runtime Service compatibility, assets, Go tests, and lint.
tags: [release, ci, quality, okf]
timestamp: 2026-06-18T00:00:00Z
---

Redeven keeps CI and local release checks aligned around source validation and generated asset determinism. OKF is part of that gate, not an optional documentation artifact.

# Mechanism

CI has a dedicated OKF bundle check that validates source integrity and verifies checked-in dist files. The main check installs Go, Node, corepack, golangci-lint, gitleaks, and ripgrep, then runs shell syntax checks, third-party notice validation, open-source hygiene, release note generator tests, Runtime Service compatibility checks, Gateway protocol contract checks, Flower protocol checks, Flower UI behavior contracts, UI lint, Desktop checks, embedded asset builds, Go tests, and golangci-lint. Release tags run the compatibility contract check and Gateway protocol contract check before building assets and packaging binaries.

# Boundaries

Checked-in generated OKF dist files must match source. Release automation should collect `okf/dist` verification files from the current tree, not from removed `internal/okf` or knowledge paths. Gateway protocol drift must fail before Gateway binaries are packaged, because `spec/openapi/gateway-v1.yaml` is the active source contract for the Gateway HTTP API.

# Citations

[1] redeven:.github/workflows/ci-check.yml:14 - CI defines a dedicated OKF bundle check job.
[2] redeven:.github/workflows/ci-check.yml:26 - OKF source integrity is checked in CI.
[3] redeven:.github/workflows/ci-check.yml:29 - OKF dist verification is checked in CI.
[4] redeven:.github/workflows/ci-check.yml:55 - CI runs shell script syntax checks across release and validation scripts.
[5] redeven:.github/workflows/ci-check.yml:92 - Open-source hygiene runs with `--all`.
[6] redeven:.github/workflows/ci-check.yml:98 - Runtime compatibility contract source checks run in CI.
[7] redeven:.github/workflows/ci-check.yml:101 - CI runs the Gateway protocol contract guard.
[8] redeven:.github/workflows/ci-check.yml:107 - CI runs the Flower UI behavior contract script.
[9] redeven:scripts/check_flower_ui.sh:16 - The local Flower UI gate runs stop/send interaction and shared timeline projection tests.
[10] redeven:.github/workflows/ci-check.yml:116 - Embedded assets are built before Go tests and lint.
[11] redeven:.github/workflows/release.yml:48 - Release tags validate the runtime compatibility contract for the tag.
[12] redeven:.github/workflows/release.yml:51 - Release tags validate the Gateway protocol contract before packaging.
[13] redeven:.github/workflows/release.yml:54 - Release tags build embedded assets before packaging.
[14] redeven:AGENTS.md:326 - Repository local quality gates include OKF integrity, dist verification, assets, Go tests, and golangci-lint.
[15] redeven:scripts/check_gateway_protocol_contract.sh:9 - The local script executes the focused Gateway OpenAPI and naming-boundary tests.

---
type: Release Contract
title: CI and release gates
description: Redeven release confidence comes from shell checks, OKF validation, UI checks, Runtime Service compatibility, assets, Go tests, and lint.
tags: [release, ci, quality, okf]
timestamp: 2026-06-17T00:00:00Z
---

Redeven keeps CI and local release checks aligned around source validation and generated asset determinism. OKF is part of that gate, not an optional documentation artifact.

# Mechanism

CI has a dedicated OKF bundle check that validates source integrity and verifies checked-in dist files. The main check installs Go, Node, corepack, golangci-lint, gitleaks, and ripgrep, then runs shell syntax checks, third-party notice validation, open-source hygiene, release note generator tests, Runtime Service compatibility checks, Flower protocol checks, UI lint, Desktop checks, embedded asset builds, Go tests, and golangci-lint. Release tags run the compatibility contract check before building assets and packaging binaries.

# Boundaries

Checked-in generated OKF dist files must match source. Release automation should collect `okf/dist` verification files from the current tree, not from removed `internal/okf` or knowledge paths.

# Citations

[1] redeven:.github/workflows/ci-check.yml:14 - CI defines a dedicated OKF bundle check job.
[2] redeven:.github/workflows/ci-check.yml:26 - OKF source integrity is checked in CI.
[3] redeven:.github/workflows/ci-check.yml:29 - OKF dist verification is checked in CI.
[4] redeven:.github/workflows/ci-check.yml:46 - CI runs shell script syntax checks across release and validation scripts.
[5] redeven:.github/workflows/ci-check.yml:72 - Open-source hygiene runs with `--all`.
[6] redeven:.github/workflows/ci-check.yml:82 - Runtime compatibility contract source checks run in CI.
[7] redeven:.github/workflows/ci-check.yml:91 - Embedded assets are built before Go tests and lint.
[8] redeven:.github/workflows/release.yml:47 - Release tags validate the runtime compatibility contract for the tag.
[9] redeven:.github/workflows/release.yml:51 - Release tags build embedded assets before packaging.
[10] redeven:AGENTS.md:279 - Repository local quality gates include OKF integrity, dist verification, assets, Go tests, and golangci-lint.

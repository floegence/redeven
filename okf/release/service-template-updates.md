---
type: Release Contract
title: Automated service-template catalog updates
description: Follow verified upstream catalog tags through isolated source updates and the exact-main integration gate.
tags: [release, automation, templates, supply-chain]
timestamp: 2026-09-07T00:00:00Z
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

The template repository's configured release sources select the official npm
`latest` dist-tag and reviewed canonical OCI tags. Registry metadata, required
platforms, and manifest content digests must verify before catalog revisions and
the catalog patch version advance. Each changed template increments its own
revision. The catalog is published with a new immutable module tag after
isolated generation, Registry preflight, generated-contract verification, SDK acquisition tests, and all upstream Go tests, including the complete frozen historical-format fixtures.

## Published dependency adoption

Redeven queries only `github.com/floegence/redeven-service-templates` through
`https://proxy.golang.org` and `sum.golang.org`. Only formal `vX.Y.Z` tags are
eligible. Prerelease tags, pseudo-versions, local paths, replacements, workspaces,
vendor copies, and checksum bypass environment settings are rejected or disabled.
The chosen module and go.mod hashes must match the exact go.sum entries.
A catalog requiring another Go toolchain or another direct dependency change
stops for a separate compatibility review.

Every candidate starts on a private `codex/automation/...` branch in an isolated
worktree. Locked JavaScript packages supply notice-generation evidence;
`THIRD_PARTY_NOTICES.md` and the three OKF bundle files are regenerated.
Focused Managed Service and catalog-boundary checks run before the candidate is
committed. Automatic commits may change only go.mod, go.sum, notices, and the
three generated OKF files. Maintained knowledge describes stable boundaries and
does not need a prose rewrite for each version number.

## Main integration and recovery

Immediately before integration the watcher fetches remote main and compares it
with the recorded base. Main changes, tag-source failures, checksum failures, or
failed focused checks abort the run. The ready branch is fast-forwarded into the
runner's local main. The normal pre-push hook then invokes
`scripts/check_final_integration.sh` once for the exact main tip accepted by the
remote push handshake. Ordinary push/PR CI retains its short source-only policy;
this daily/manual updater performs the full pre-push gate.

The watcher pushes the full current main tip without force. If remote main
advances during the gate, Git rejects the push. No commit is rolled back or
overwritten to win a race. A failed gate can leave a candidate on the ephemeral
runner's local main, but it is never published. A network error after a push can
have an uncertain outcome; inspect remote main before retrying. GitHub Actions
marks failed runs and records diagnostics in the job summary. Each run removes
only its own temporary worktree and private branch.

# Boundaries

The schema/acquisition npm SDK is independently pinned to a formal upstream release tarball and SHA-512 in Desktop and Env App lockfiles. SDK changes require explicit source review and both acquisition-mode tests; a catalog recommendation-only patch does not automatically change that SDK dependency.

External GitHub template sources are outside this watcher. They are checked and updated only through the user-driven [Git source review](../architecture/managed-service-git-sources.md) flow, never by repository scheduling or application startup.

The watcher creates no Redeven product release tag or installation package.
Catalog recommendations reach users through the next normal Redeven release.
Recommendations affect new-install defaults and explicit update choices only.
The [Managed Service release contract](../architecture/managed-service-release-discovery.md)
owns installed release identity and user-selected upgrades; catalog adoption
does not rebuild, restart, or upgrade installed instances.

# Evidence

- `redeven:.github/workflows/update-service-template-dependency.yml` - Schedules isolated updates, prepares dependencies, and constrains generated output.
- `redeven:scripts/update_service_template_dependency.mjs` - Enforces public module discovery, checksums, exact sums, no-op, and failure restoration.
- `redeven:scripts/integrate_service_template_update.sh` - Checks the frozen base, fast-forwards local main, and invokes the normal push hook.
- `redeven:scripts/service_template_publication.test.mjs` - Exercises successful publication, gate failure, and remote main races against a real bare Git remote.
- `redeven:scripts/update_service_template_dependency.test.mjs` - Covers formal versions, local wiring, checksum failure, and no-op behavior.

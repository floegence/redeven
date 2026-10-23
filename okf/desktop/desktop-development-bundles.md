---
type: Development Contract
title: Desktop development sessions and bundles
description: Run current-source local development services together and bound generated packages without removing live bundles.
tags: [desktop, development, storage, retention]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

- Authority: the launcher owns its Desktop session, local Runtime, saved local host Gateways, and immutable bundles.
- Outcome: run current checkout code, stop together, and prune obsolete bundles after publication.
- Invariants: preserve identities, user data, unrelated services, and recent, selected or live bundles.
- Failure boundary: preparation failure prevents launch and triggers cleanup; incomplete inventory prevents pruning.

# Contract

## Development service lifecycle
`scripts/dev_desktop.sh` builds Desktop and its Runtime bundle from the current checkout, including uncommitted source.

Desktop and Runtime builds capture HEAD, tracked and non-ignored untracked
inputs, including local edits. Verification after builds and before startup
rejects concurrent edits or checkout advances. The three generated OKF bundles
are outputs excluded by exact path alongside ignored assets. OKF Markdown,
its builder and Go embed source remain protected inputs.

Normal Electron exit, startup failure after service preparation begins, Ctrl+C, and SIGTERM stop the development Runtime and local Gateways.

Development coordination belongs to the launcher, not to product shutdown.

Launch and preflight use the shared Electron resolver: package/installer logs
go to stderr; only the exported path returns. Download failures propagate and
executability is checked. Launch resolves after builds, which may reinstall
Desktop dependencies.

## Bundle retention
`scripts/dev_desktop.sh` publishes each complete bundle below `<development-state-root>/desktop/bundles/<manifest-sha256>` and then runs retention before launching Electron. The selected bundle is always retained, including reuse of an older build.

Retention is a count bound on inactive verified packages, not a byte quota; active processes and unverified entries can require additional space.

# Boundaries

Only generated packages within the selected development profile participate. In-progress build directories belong to their builders.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Complete bundle publication and startup cleanup.

- `redeven:scripts/source_build_identity.mjs` - Shared source identity and mixed-build rejection.

- `redeven:scripts/desktop_bundle_build_contract.test.mjs` - Checkout advance, dirty sources, and preserved staging boundaries.

- `redeven:scripts/ui_package_common_node_test.sh` - Resolution, diagnostics, failure and preflight.

- `redeven:scripts/dev_desktop_signal_cleanup_test.sh` - Download, reinstall and cleanup.

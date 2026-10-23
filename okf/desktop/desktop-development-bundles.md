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

- Authority: the development launcher owns its selected Desktop session, local Runtime, saved local host Gateways, and immutable generated packages.
- Outcome: development services run current checkout code and stop together; repeated launches remove obsolete packages after publishing the next complete bundle.
- Invariants: preserve service identity and data; keep recent, selected, and live bundles; never stop unrelated services or remove user data.
- Failure boundary: service preparation failures prevent Desktop launch and trigger cleanup; incomplete process inventory prevents bundle deletion.

# Contract

## Development service lifecycle
`scripts/dev_desktop.sh` builds Desktop and its Runtime bundle from the current checkout, including uncommitted source.

Desktop and source-built Runtime bundles capture HEAD and the actual tracked
and non-ignored untracked inputs before compilation, including intentional
local edits. Verification after asset and Runtime builds and before service
startup rejects concurrent source edits or checkout advances. The three
regenerated OKF bundle files are outputs, even though they are committed;
they are excluded by exact path alongside ignored generated assets. OKF
Markdown, its builder, and the Go embed source remain protected inputs.

Normal Electron exit, startup failure after service preparation begins, Ctrl+C, and SIGTERM stop the development Runtime and local Gateways.

Development coordination belongs to the launcher, not to product shutdown.

## Bundle retention
`scripts/dev_desktop.sh` publishes each complete bundle below `<development-state-root>/desktop/bundles/<manifest-sha256>` and then runs retention before launching Electron. The selected bundle is always retained, including reuse of an older build.

Retention is a count bound on inactive verified packages, not a byte quota; active processes and unverified entries can require additional space.

# Boundaries

Only generated packages within the selected development profile participate. In-progress build directories belong to their builders.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Complete bundle publication and startup cleanup.

- `redeven:scripts/source_build_identity.mjs` - Shared source identity and mixed-build rejection.

- `redeven:scripts/desktop_bundle_build_contract.test.mjs` - Checkout advance, dirty sources, and preserved staging boundaries.

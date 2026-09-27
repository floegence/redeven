---
type: Runtime and Product Contract
title: Built-in browser Linux system preparation
description: Authorize exact versioned AppArmor preparation without weakening the browser sandbox.
tags: [runtime, browser, installation, linux, security]
timestamp: 2026-09-27T00:00:00Z
---
# Summary

- Authority: the browser installation manager owns package and launch readiness; a short-lived Runtime command performs the explicitly authorized system transaction.
- Outcome: Ubuntu user-namespace restrictions produce an actionable preparation step, and normal opens reuse the prepared version without repeated authorization.
- Invariants: keep Chromium sandboxing and global AppArmor settings; only compiled catalog bytes may occupy a fixed, root-owned system path; no credentials cross the business API.
- Failure boundary: missing dependencies, unavailable sandbox and unknown launch failures stay distinct; cancelled or failed publication cannot claim readiness or replace saved browser data.

# Contract

## Readiness

The existing installation snapshot reports package state separately from `launch`
state, structured reason and applicable action. Package presence alone is not
readiness. Runtime resolves the executable again at launch. A bounded native
`--version` probe recognizes missing shared libraries without opening a page;
unknown failures retain their own category. Snapshot probe results may be cached
briefly, but real launch checks are fresh. A classified sandbox failure remains
preparation-required even when policy files still exist; only successful system
preparation clears that observed condition. Startup failure does not retire the
shared browser service: process fault handling begins after a successful handshake.

When Linux restricts unprivileged user namespaces, the exact catalog version runs
from `/opt/redeven/browser/<sha256>/...`. Every ancestor, executable, readiness
receipt and policy must be root owned and not group or world writable. The policy
matches only that executable and grants its required user namespace capability.
Neither `--no-sandbox`, global AppArmor changes nor exemptions for replaceable
user-owned executables are permitted.

## Explicit preparation

The shared installation controller starts `prepare_system` only after user action.
It reuses the verified original Linux archive, or the existing confirmed download
or Desktop transfer path if the archive is absent. The normal enabled switch,
operation ID, progress subscription, cancellation and one-shot open continuation
remain authoritative. Closing a panel retires continuation without cancelling
confirmed background work. Installation consent and package integrity remain
owned by [browser installation](computer-use-browser-installation.md).

Runtime supplies a shell-quoted `browser-system-authorize` command for execution
in the target environment terminal. Its short-lived private Unix socket carries
only the compiled package identity, archive and fixed phase messages. `sudo`
handles system authentication directly through the terminal; passwords are never
business API inputs, logs or stored state. Authorization and transfer expire after
15 minutes. No root daemon is installed.

The privileged `browser-system-install` command accepts only the native package
identity in its compiled catalog and exact archive bytes. It does not accept an
installation path, arbitrary command or policy text. Released artifactcache verifies
the archive before extraction into a private root-owned stage. A lock serializes
publication, version receipts prevent replacement of unrelated content, and the
readiness marker is committed only after exact policy loading succeeds. Failures
remove this transaction's staging and preserve prior versions. Runtime independently
checks the installed version and policy before accepting the ready phase.

The operation retains personal browser processes, browser profiles, login state,
bookmarks and saved tab recovery records. System preparation changes only the
verified built-in browser version and its narrowly matched policy.

# Evidence

- `redeven:internal/browserinstall/system_readiness.go` - Single readiness state and structured action.
- `redeven:internal/browserinstall/system_preparation.go` - Environment operation, private authorization stream and bounded lifetime.
- `redeven:internal/browserinstall/system_linux.go` - Fixed privileged publication, trusted paths and exact AppArmor policy.
- `redeven:cmd/redeven/browser_system.go` - Terminal-owned sudo authentication and restricted command arguments.
- `redeven:internal/browserinstall/system_acceptance_test.go` - Privileged transaction success, cancellation, invalid bytes, policy failure and interrupted publication.
- `redeven:internal/browserinstall/system_linux_test.go` - Exact policy, unsafe path rejection and dependency classification.

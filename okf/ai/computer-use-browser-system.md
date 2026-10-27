---
type: Runtime and Product Contract
title: Built-in browser Linux system preparation
description: Authorize exact versioned AppArmor preparation without weakening the browser sandbox.
tags: [runtime, browser, installation, linux, security]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Installation manager owns readiness; a short Runtime command performs the approved system transaction. Ubuntu namespace restrictions get explicit preparation, then version reuse. Preserve Chromium sandbox/global AppArmor; admit only catalog bytes at a fixed root-owned path, without API credentials. Dependencies, sandbox and unknown launch failures stay distinct; failed/cancelled publication preserves data.

# Contract

## Readiness
The existing installation snapshot reports package state separately from `launch` state, structured reason and applicable action. A bounded native `--version` probe recognizes missing shared libraries without opening a page; unknown failures retain their own category.

Neither `--no-sandbox`, global AppArmor changes nor exemptions for replaceable user-owned executables are permitted.

## Explicit preparation
The shared installation controller starts `prepare_system` only after user action. The normal enabled switch, operation ID, progress subscription, cancellation and one-shot open continuation remain authoritative.

Runtime independently checks the installed version and policy before accepting the ready phase.

# Boundaries

The operation retains personal browser processes, browser profiles, login state, bookmarks and saved tab recovery records. System preparation changes only the verified built-in browser version and its narrowly matched policy.

# Evidence

- `redeven:internal/browserinstall/system_readiness.go` - Single readiness state and structured action.

- `redeven:internal/browserinstall/system_linux.go` - Fixed privileged publication, trusted paths and exact AppArmor policy.

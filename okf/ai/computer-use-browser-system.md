---
type: Runtime and Product Contract
title: Built-in browser Linux system preparation
tags: [runtime, browser, installation, linux, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Installation manager owns readiness; short approved Runtime transactions prepare Linux namespaces/dependencies. Preserve sandbox/global AppArmor and admit only catalog bytes at fixed root-owned paths. Separate dependency, sandbox and unknown launch failures; failed publication preserves data.

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

- `redeven:internal/browserinstall/system_readiness.go` - Source.
- `redeven:internal/browserinstall/system_linux.go` - Source.

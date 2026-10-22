---
type: Runtime and Product Contract
title: Optional built-in browser installation
description: Confirm browser acquisition, persist the environment capability switch, and keep setup separate from canonical Flower questions.
tags: [ai, computer-use, browser, installation, desktop]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns one optional Chromium installation per Runtime state directory.
The capability is enabled by default, but discovery, opening settings, enabling,
and agent tool execution never download bytes. Only an authenticated user's
explicit confirmation starts environment download or automatic Desktop acquisition and upload.
Disabling persists, cancels installation, closes managed browser processes and
blocks further use and installation prompts. Installed bytes and website data
remain. Floret owns the input wait and continuation; installer status never
becomes a second conversation lifecycle. Failed verification never publishes a
partial package, and failures offer an explicit retry or alternative source.

# Contract

## User contract
The shared Browser and desktop dialog opens Browser settings for this environment.

Users never choose a file   or follow an archive download link.

No agent installation tool, automatic re-enable, shell fallback or target substitution is introduced.

## Distribution and state
Standard Runtime release suites carry `computer.zip`: official Node, published Playwright, QuickJS, the published FloeBrowser SDK and its native media collector, and product helpers, with a closed SHA-256 file inventory.

The Runtime never accepts a client-supplied URL, executable path or checksum.

No installation automatically restarts following a Runtime restart.

# Boundaries

Discovery, settings and agent execution cannot initiate installation. Verification failure never publishes a partial package; recovery requires an explicit retry or alternative source.

# Evidence

- `redeven:desktop/src/main/runtimePackageCache.ts` - complete source suites and cache admission.

- `redeven:scripts/stage_computer_resources.mjs` - verified native and cross-platform helper staging.

- `redeven:internal/browserinstall/manager.go` - preference, upstream acquisition and atomic package publication.

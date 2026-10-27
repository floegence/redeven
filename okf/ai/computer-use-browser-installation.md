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

Runtime owns one optional Chromium install. Enabled by default, it downloads only after authenticated user confirmation, never discovery/settings/tools. Disable persists, cancels install, closes managed processes and blocks use/prompts while retaining bytes/site data. Floret owns waiting/continuation. Failed verification publishes no partial package; offer explicit retry/source choice.

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

- `redeven:internal/browserinstall/manager.go` - preference, upstream acquisition and atomic package publication.

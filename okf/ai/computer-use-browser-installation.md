---
type: Runtime and Product Contract
title: Optional built-in browser installation
tags: [ai, computer-use, browser, installation, desktop]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime owns optional Chromium installation, enabled by default but downloaded only after authenticated confirmation. Disable cancels/closes/blocks prompts while retaining bytes/site data. Floret owns waiting/continuation; failed verification publishes nothing and exposes Retry/source choice.

# Contract

## User contract
The shared Browser and desktop dialog opens Browser settings for this environment.

Users never choose a file   or follow an archive download link.

No agent installation tool, automatic re-enable, shell fallback or target substitution is introduced.

## Distribution and state
Standard Runtime release suites carry `computer.zip`: official Node, published Playwright, QuickJS, the published FloeBrowser SDK and its native media collector, and product helpers, with a closed SHA-256 file inventory.

Offline delivery retains this helper suite and does not include Chromium. Missing browser binaries remain an explicitly confirmed online installation; packaging optimization cannot initiate downloads or change browser selection. The media collector is selected for the suite target before the closed inventory is generated, preserving the upstream manifest as evidence and enforcing runtime digest checks. macOS signing derives the selected runtime digest only after verifying unchanged executable content; see [Desktop bundle contracts](../desktop/desktop-development-bundles.md).

The Runtime never accepts a client-supplied URL, executable path or checksum.

No installation automatically restarts following a Runtime restart.

# Boundaries

Discovery, settings and agent execution cannot initiate installation. Verification failure never publishes a partial package; recovery requires an explicit retry or alternative source.

# Evidence

- `redeven:desktop/src/main/runtimePackageCache.ts` - Source.

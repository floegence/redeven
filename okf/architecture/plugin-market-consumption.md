---
type: Architecture Contract
title: Plugin market consumption
tags: [architecture, plugins, market, release]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Redeven consumes one complete public market representation. Official and community are display classifications, not admission privileges. Packages remain ordinary `.redevplugin` assets in GitHub Releases; every installation uses the released Host inspection and durable installation APIs.

# Contract

- Startup reads the validated local cache without waiting for the market. Refresh uses ordered pages, one generation, complete inspection-derived previews, and atomic last-known-good replacement. No client capability headers, compatibility variants, per-plugin latest fan-out, or incomplete-entry fallback exists.
- Discovery uses the `redevplugin` GitHub topic plus rechecks of already indexed repository identities. A fixed-commit `.redevplugin/index.json` selects ordinary packages in independent `<release-key>-v{version}` namespaces. No developer registration, plugin signatures, publisher trust, declaration approval, or separate third-party client path is required.
- Ingest uses the released verifier and rechecks repository, release, tag commit, asset identity and bytes. Reject cross-repository plugin-ID takeover and same-version replacement. Failed scans retain the last valid projection.
- Market retains one release per plugin/channel and bounded verified presentation/icons. It never proxies packages or grants lifecycle authority. Unavailable listings constrain discovery without revoking installations.
- Inspection matches publisher/plugin/version, package/security/contract hashes and repository/release/asset identities. Both classifications share review and commit.
- Installed presentation and permission requirements come from the installed package and Host-verified contracts. Newer market metadata cannot replace installed declarations or authorization facts.

## Network behavior

Market and package requests use the product network adapter, current environment/system proxy policy, and OS DNS/VPN routing. Startup stays cache-only. Singleflight, bounded backoff, jitter, cancellation, and generation reconciliation avoid request storms. Network failures cannot remove installed state or block ordinary Runtime startup. The service closes only transports it owns.

# Boundaries

Market owns discovery; Redeven owns presentation and authenticated scheduling. [Lifecycle](redevplugin-package-lifecycle.md) defines platform authority and distinguishes platform/runtime signatures from unsigned plugins.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Source.
- `redeven:internal/pluginmarket/contracts.go` - Source.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts` - Unified lifecycle client.

---
type: Release Contract
title: Plugin integration gate
tags: [release, plugin, integration, ui]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The plugin integration gate proves that the released ReDevPlugin Host and market contracts remain aligned with Redeven's authorization, placement, renderer, and Desktop lifecycle adapters. It uses the published package and isolated smoke profiles; copied platform paths, implicit grants, second bridges, and stale lifecycle projections fail closed.

# Contract

The focused plugin gate covers:

- Host construction, authenticated owner/session mapping, direct authorization,   explicit origin/CSRF/action policy, and stable observability; - market release install/update and exact publisher/plugin/instance identity,   market preview digests, stable progress, and no duplicate package parser; - public HTTPS URL, GitHub Release, and local `.redevplugin`   inspect-confirm-install admission, process-local TTL inspection identity,   strict source provenance, exact owner/session/bytes/hash revalidation,   enabled install state with no implicit grants, permission-attention handling   for missing access, and no durable receipt/query lifecycle; - runtime path/target/hash, ProcessManager health, persistent lease replay, and   Host storage/network/Event services; - canonical AppServer route reservation/delegation and Local UI access checks; - generated UI lifecycle DTOs, management revisions, production Plugin entry,   generic permission requirements, exact inventory-key selection, full external   security and source-provenance review, exact generic permission ids, FIFO   confirmation, and close-before-placement lifecycle; - Shell-root multi-window Activity chrome, standard `redeven.plugin` Workbench   persistence, released interaction ownership, exact-surface close   reconciliation, and cross-placement serialization; - static absence of legacy proxy/bootstrap/base64 package and copied platform   paths.

Mock containers do not satisfy this check.

# Boundaries

The main CI and release gate owns validation ordering and exact-main provenance. This concept owns only integration behavior and its focused renderer/Desktop evidence; it does not create a second package parser, release manifest, or transport implementation.

# Evidence

- `redeven:scripts/check_plugin_integration.sh:1` - Defines focused ReDevPlugin integration coverage.

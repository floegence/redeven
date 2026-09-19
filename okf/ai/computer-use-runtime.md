---
type: AI Tool Contract
title: Computer and browser use runtime
description: Keep target execution, authorization and observation under one Runtime owner while composing semantic actions in bounded scripts.
tags: [ai, computer-use, browser-use, targets]
timestamp: 2026-09-19T00:00:00Z
---
# Summary

`ComputerUseRuntime` owns targets, adapter resources, active control and script
processes. Published Floret owns Agent lifecycle, tool effects and canonical
results. Flower prefers authorized commands and integrations for data work,
semantic browser or desktop operations for interaction, and explicit images for
visual decisions. A missing target, permission or capability fails explicitly;
no adapter silently selects another tab, window or device.

# Contract

## Execution

`computer.observe` reads bounded semantic information, with an optional image.
`computer.exec` composes operations in one bounded JavaScript invocation; see
[script execution](computer-use-scripts.md). The existing screenshot, click,
double-click, type, key, scroll, drag, wait and browser navigation tools remain
available through the same target executor. A GUI-verification request still
requires observable GUI evidence; command output alone cannot satisfy it.

An invocation resolves the canonical ThreadID, TurnID, RunID and tool call from
Floret. Product policy authorizes the concrete target, readiness performs the
real helper handshake, and the existing target gate serializes execution and
live sampling. The same policy is checked before every script host operation.
A batch cannot change its target or enlarge its grants. Selection and grants
follow the [target access contract](computer-use-target-selection.md).

Desktop's renderer bridge admits these product routes through the same exact
method/path/query allowlist as other Flower requests. Target selection, access,
managed profiles and extension setup require declared routes and bounded unique
thread/profile query parameters. This routing check does not grant target access;
the Runtime remains the authorization owner.

Script variables, node references, target controls and active helpers are bounded
process-local state. There is no browser action journal, durable program counter
or second Agent lifecycle store. Only product settings, managed browser profiles,
downloaded files, canonical tool results and necessary media survive restart.
The [takeover contract](computer-use-takeover.md) owns private input and safe
continuation. Uncertain irreversible effects remain terminal
`effect_outcome_unknown`; neither script nor helper replay is allowed.

## Platform adapters

The [browser contract](computer-use-browser.md) covers managed profiles, explicit
CDP tabs and same-device Chrome extension bindings. They share one controlled
page implementation. The [desktop contract](computer-use-desktop.md) covers
macOS window AX operations and private Linux Xvfb/AT-SPI. Native capabilities
remain explicit: Accessibility permission alone does not prove background input.
Windows, Safari and locked-desktop automation are outside this implementation.

The agent and the viewer have separate observation needs. Semantic operations
return compact results without a screenshot for every host action. Explicit
screenshots and visual primitives return checked keyframes. Stage viewing uses
its independent bounded sampler; those samples never enter model history. See
[Computer media](computer-use-media.md).

## Task access

Each computer invocation receives the permission snapshot established at its
tool authorization boundary. Authenticated user controls use the current saved
setting; their TurnID is interaction provenance, not a model invocation. `full_access` includes HTTP/HTTPS origins, applications
and temporary foreground use on the selected target; other modes use saved
resource grants. Runtime verifies the thread and rereads resource grants after
acquiring the target gate for every operation, including script host calls and
handback. A mode change applies to the next invocation and cannot rewrite a
running script's snapshot. Explicit grant changes remain live and invalidate
active scripts. Guest code cannot supply authorization.

Full access does not change target ownership, OS capabilities, explicit Stop,
private-input handling or unknown-effect settlement. Target selection chooses
where work runs; it is not another confirmation of an already authorized action.

## Packaging and compatibility

Browser execution JSONL and Native Messaging use protocol 6 for Runtime-owned pause control, explicit page
selection, reveal, popup progress and confirmed progress on observation failure.
Only readonly inspection is retried; actions and scripts are never replayed.
Native execution remains protocol 3. All carry
host-owned `full_access` authorization. Inventory and isolated JavaScript helpers
retain protocol 2. Desktop and Runtime negotiate compatibility epoch 27 and
minimum version v0.13.0. Older execution helpers and
resource inventories are rejected instead of used as a silent substitute. The
compatibility JSON remains the release authority, independently of this document.

Desktop bundles a verified official Node distribution, Playwright and Chromium,
QuickJS/WASM pinned at 0.32.0, the Chrome extension and the native helper. Every
required resource is covered by the existing SHA-256 inventory. Runtime paths
are absolute packaged paths; source checkouts, ambient browser caches and PATH
lookups are not runtime dependencies. Startup emits closed diagnostic codes,
not raw browser exceptions, credentials or page contents.

Node acquisition still verifies official checksums, uses an atomic digest-keyed
builder cache and bounds stalled transfers. The cache is not a Runtime input.
Checksum retrieval and archive transfers each make at most three attempts for
transient transport errors, including TLS handshake disconnects (curl 35), with
one- and two-second delays. Checksums are fetched anew for each attempt; archive
transfers resume only the current build's temporary file. HTTP rejection,
certificate validation failures and checksum mismatches stop without retry.
Even cached or explicitly supplied archives require successful retrieval of the
official checksum and a matching SHA-256 before use.
Relocated-bundle qualification must run both Chromium and QuickJS without source
or a browser cache. Native window capture continues to respect Desktop-window
exclusion and never substitutes an unrestricted display capture after failure.

# Boundaries

The [qualification contract](computer-use-qualification.md) owns acceptance and
performance evidence. Compilation, semantic fixtures and protocol tests do not
establish every product flow or a measured speedup. Real browser tests currently
cover native popup effects and require separate child-target authorization. The paired managed-browser benchmark, complete
Linux UI scope and macOS native fixtures pass their declared scopes; complete
Desktop qualification and exact-main integration remain required for delivery.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - target resources and readiness owner.
- `redeven:desktop/src/main/runtimeFlowerRoutes.ts` - exact Desktop IPC routing to Runtime endpoints.
- `redeven:internal/ai/run.go` - canonical tool boundary and partial error results.
- `redeven:internal/ai/computer_tools.go` - provider-visible tools and guidance.
- `redeven:internal/ai/prompt_builder.go` - command, semantic and visual tool preference.
- `redeven:internal/runtimeservice/compatibility_contract.json` - exact compatibility window.
- `redeven:scripts/stage_computer_resources.mjs` - pinned, hash-inventoried resources.
- `redeven:scripts/stage_computer_resources.test.mjs` - relocated Chromium and QuickJS qualification.
- `redeven:scripts/resolve_node_archive.test.mjs` - bounded checksum and archive retries, verified cache reuse and integrity failures.

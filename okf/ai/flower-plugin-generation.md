---
type: AI Product Contract
title: Flower plugin generation
tags: [ai, flower, plugins, floret]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Flower helps users author ReDevPlugin applications through the released CLI and
SDK. Its on-demand system skill follows the exact platform version imported by
Redeven. Redeven owns intent collection, prompt guidance, product review and
placement. ReDevPlugin owns templates, bindings, build validation, development
state, preview, package admission and execution. Floret owns tool dispatch and
approval lifecycle.

# Contract

## Discoverable author guidance

The embedded `redeven-plugin-authoring` system skill appears in the ordinary
skill catalog. Its description distinguishes application plugin authoring from
Flower Agent Plugins and MCP configuration. It is loaded through normal skill
activation, remains user-disableable, and does not expand the global system
prompt. Its installation coordinate is projected from the imported ReDevPlugin
platform version before catalog, browse or model content is exposed; it carries
no independent version pin.

The guidance starts from the user's project and preserves its identity and data
contracts. New projects select the smallest released template that satisfies the
request. Pure Web surfaces may use declared private resources without a Worker.
Worker execution uses the published WASM toolchain and verified development
runtime. Missing platform or business capabilities remain explicit requirements.

## Released author workflow

ReDevPlugin 3.14.0 owns doctor readiness diagnostics, the shared generation,
typecheck, build, business-test and package pipeline, event-driven watching,
persistent development roots, manual update candidates, fresh session authority,
controlled connection review and runtime preparation. Flower invokes these tools
and uses their actual stage reports. It does not duplicate their validators,
watchers, lifecycle state or runtime supervisor.

Manual preview updates preserve the current frame and drafts while a candidate
builds. Applying or reloading creates a fresh frame and requires saved application
data for continuity. Failed builds preserve the last valid preview. Explicit
persistent roots survive restarts; reset is an intentional destructive action.
Configurable connections retain destination review, explicit grants and revocation.
Doctor readiness and business/package tests do not establish browser or real WASM
execution. Acceptance exercises the actual requested user journey and identifies
which boundaries were verified.

## Delivery and installation

An authoring request may run authorized local project steps through normal tools.
Final sources and packages belong at the user's project or chosen destination.
Installation uses the released package inspection, exact-byte review and
confirmation flow in Plugin Center. Installation approval, execution grants,
signing trust and automatic-update eligibility remain independent facts.

A plugin-generation handler must not perform a second approval wait, bypass
Floret dispatch, mutate Flower activity rows directly, or convert plugin audit
rows into Flower timeline state. An uncertain effect is inspected rather than
blindly replayed. A requested approval remains waiting until Floret resolves it.

# Boundaries

Flower does not write platform registry rows, mint bridge tokens, expose plugin
assets through ordinary product routes, bypass signature assessment or trust
policy, grant storage/network/runtime authority outside released brokers, or
invoke business adapters before ReDevPlugin constructs the request context.
Missing shared mechanics are fixed upstream and released before consumption.
Development runtime evidence never substitutes for product signing or packaging.

# Evidence

- `redeven:internal/ai/system_skills/redeven-plugin-authoring/SKILL.md` - On-demand product authoring guidance.
- `redeven:internal/ai/system_skills.go` - Imported platform version projection for embedded content.
- `redeven:internal/ai/system_plugin_authoring_test.go` - Model catalog, activation, browse content and disable behavior.
- `redeven:internal/redevpluginintegration/runtime_io_live_test.go` - Published author Worker through the product runtime and structured failure recovery.
- `redeven:okf/ai/ai-tool-runtime.md` - Floret permission lifecycle before dispatch.

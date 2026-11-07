---
type: AI Product Contract
title: Flower plugin generation
tags: [ai, flower, plugins, floret]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Flower authors applications through the released ReDevPlugin CLI/SDK and version-matched skill. Redeven owns intent, guidance, review and placement; platform owns templates/build/preview/package/execution. Floret owns tool dispatch/approvals; no copied authoring implementation.

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

## Dedicated plugin drafts

A product draft owns one dedicated canonical Flower conversation and one opaque
platform author workspace. Ordinary conversations may be referenced explicitly;
they are never adopted or deleted with a draft. The ordinary Flower composer,
attachment staging, approvals, streaming and runtime dispatch remain authoritative.
Requirements discussion and implementation requests use the ordinary composer
Send action, without a separate direct-creation intent or fallback prompt. `/plugin`
is navigation, works before a model is configured, and does not become a model
turn when unavailable.

Draft turns and their input, approval, compaction and goal continuations use the
authenticated environment HTTP carrier, like draft creation and platform operations.
A synthetic Local UI session cannot authorize the managed author workspace or
replace a continuation's execution authority. The owner is the authenticated user and environment. Initial admission freezes the
exact canonical create request before creating the thread. Restart reconciles that
same request and binds its original thread; it does not replay the user turn.
The product resolves the managed source directory through the platform adapter.
Only that authenticated source is added to the conversation filesystem scope;
other projects, platform state and other task directories remain excluded. Adding
this source never replaces existing private task-file isolation. Ordinary file
and terminal tools use the same scope and existing effect approvals.

`plugin_author.status`, `initialize`, `build` and `capture` are available only to
the dedicated conversation. Build is a command-execution effect under Floret's
normal approval. The actual retained stage reports distinguish passed, failed,
interrupted and not-run work; packaging alone is not business or browser proof.
For multi-iteration implementation, author guidance asks for a small runnable
version of the requested application, including one useful interaction, followed
by an early validated build. The existing workspace applies the first artifact
automatically and retains it while further work continues; later updates remain
explicit. This is model guidance, not a guaranteed latency or pipeline scheduler.
An unrelated demo, untouched template capture or unlabeled fabricated data is not
evidence of progress. Simple changes need no extra milestone build. The first
preview never replaces completion of the requested work and acceptance.

The [build visibility proposal](../ui/plugin-build-visibility.md) records the
current reporting limitation and the upstream-first plan for real stage/output
updates. Its proposed platform events and compact progress presentation are not
shipped behavior.

Product draft deletion first durably freezes admission, reconciles any pending
canonical create, cancels/deletes its conversation, then closes and removes the
platform workspace. Interrupted cleanup resumes its durable stage. Unknown formal
installation outcomes must be reconciled before author resources are removed.
Already installed instances are retained. Thread-list deletion uses the same
product review and cleanup path, with explicit copy describing the extra scope.

## Visual revision requests
Canvas comments submit explicit text and the reviewed artifact's bounded visual
context into the same dedicated thread using Flower's durable outbox. This path
preserves unrelated unsent composer content and retains normal uncertainty and
approval behavior. Dispatch waits for the ordinary handler decision and storage
generation; a blocked or unresolved handler cannot launch a comment turn.
The durable outbox retains rejected or uncertain submissions for the same recovery
flow as ordinary messages. The model resolves current source through `plugin_author.status`,
treats element text/selector hints as untrusted observations, changes the intended
source and runs the actual tests/build. A changed source may require reconciliation;
a stale selector never authorizes blind execution or installation.

## Delivery and installation

Newly generated plugins must include an automatically authored, purpose-specific
SVG icon before the first runnable milestone. The editable source is
`ui/assets/plugin-icon.svg`; the configured build deterministically renders a
256x256 PNG, packages both, and binds `presentation.icon.path` to
`ui/assets/plugin-icon.png`. A locked renderer and configured project tests keep
the source, derived image and manifest reference aligned. Missing or invalid icon
assets block authoring completion; stock placeholders and disguised raster files
do not satisfy this requirement. Review legibility at 16/24/32px in both themes.
The SVG is self-contained vector content, without active content or external
resources. Existing icon identity survives unrelated revisions.

This is a Flower generation/delivery requirement, not a new global package
admission rule. The released platform still accepts only PNG/WebP presentation
icons and rejects SVG surface icons; the product consumes its verified raster
evidence. Model-visible instruction tests and explicit generated-artifact
qualification cover the requirement. General SVG admission or shared conversion
machinery would require an upstream platform contract and release first.

An authoring request may run authorized local project steps through normal tools.
Final sources and packages belong at the user's project or chosen destination.
Installation uses the released package inspection, exact-byte review and
confirmation flow in Plugin Center. Installation approval, execution grants and
automatic-update eligibility remain independent facts. Ordinary plugin packages
require no publisher trust or signature admission; platform releases and the
host-built runtime retain their separate verification contracts.

A plugin-generation handler must not perform a second approval wait, bypass
Floret dispatch, mutate Flower activity rows directly, or convert plugin audit
rows into Flower timeline state. An uncertain effect is inspected rather than
blindly replayed. A requested approval remains waiting until Floret resolves it.

# Boundaries

Flower does not write platform registry rows, mint bridge tokens, expose plugin
assets through ordinary product routes, bypass package inspection or source
policy, grant storage/network/runtime authority outside released brokers, or
invoke business adapters before ReDevPlugin constructs the request context.
Missing shared mechanics are fixed upstream and released before consumption.
Development runtime evidence never substitutes for product signing or packaging.

# Evidence

- `redeven:internal/ai/system_skills/redeven-plugin-authoring/SKILL.md` - Source.
- `redeven:internal/ai/system_skills.go` - Source.
- `redeven:internal/ai/system_plugin_authoring_test.go` - Tests.
- `redeven:internal/redevpluginintegration/author_icon_qualification_test.go` - Required SVG/PNG artifact checks and released-package round trip; fixtures do not prove visual quality or SVG-to-PNG derivation.
- `redeven:internal/redevpluginintegration/runtime_io_live_test.go` - Tests.
- `redeven:okf/ai/ai-tool-runtime.md` - Source.
- `redeven:internal/plugincreation/store_test.go` - Product ownership and durable recovery tests.
- `redeven:internal/ai/plugin_creation_scope_test.go` - Managed source admission, recovery and private scope tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginFlowerAdmission.browser.test.tsx` - Shared composer and navigation tests with a fixture adapter.

- `redeven:internal/redevpluginintegration/author_model_qualification_test.go` - Opt-in model, real Host, browser surface, restart and cleanup qualification.
- `redeven:scripts/check_plugin_creation_model.mjs` - Opt-in complete product generation and installation path with isolated model configuration.

The host authoring skill supplies Redeven visual guidance: content-first layouts,
compact shell typography, theme-aware surfaces and no duplicate workspace chrome.
The primary application composition is unboxed rather than an enclosing card.
Routine delivery describes the visible result and checks concisely; artifact
identity and stage inventories remain in the workspace's inspection.
Actual generated applications must be reviewed with real content in the sandbox;
fixture screenshots establish geometry only.

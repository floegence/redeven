---
type: Qualification Evidence
title: Flower context distribution qualification
description: Historical token attribution evidence and current native-token plus visible-character qualification.
tags: [flower, context, deepseek, qualification]
timestamp: 2026-10-18T00:00:00Z
---
# Summary

Current presentation uses published Floret v7.60.3: native input tokens and
same-request visible Unicode characters are independent facts. Historical token
comparison and remainder results below are retained as evidence, not current
product behavior or proof of complete OpenAI attribution. The current contract
is [Presentation](../ai/flower-managed-model-context.md#presentation).

# Contract

Date: 2026-10-16. Upstream: published Floret v7.47.1, commit
6962bd2. This task changes estimation, attribution and presentation, not prompts.

## Diagnosis and ownership

The previous total and categories described different inputs: the prepared wire
request supplied the budget, while canonical messages were counted separately
for distribution. That second path could miss protocol projection, restored
history and tool merging. It could select a tokenizer using a configured
provider instance ID instead of the adapter type and model alias, double encode
text as JSON and mix conservative budget reserve into displayed amounts.
Parallel reasoning and incomplete source propagation introduced further drift.

Floret now owns decoded content extraction, tokenization, content attribution
and budget calculation from the frozen effective request. Category counts and
safety budgets share the same tokenization. Reserve and media safety remain
budget inputs, not adjustments to make categories equal native usage. Source
metadata stays outside the model payload. Missing or invalid optional source
mapping omits distribution with a sanitized diagnostic while preserving a valid
execution budget. No second estimator, persistence store or retry lifecycle was
added in Redeven.

Redeven's adapter maps typed canonical source intervals to final protocol
paths, including aliases, merged instructions, multiple text blocks and Chat's
synthetic tool-image user messages. It does not count tokens. Tests first
reproduced the tool-image ordinal failure, then verified the structural fix.

v7.47.0 introduced the shared estimator. Real runtime verification exposed
transient source intervals being lost when cached message snapshots or retry
JSON were reconstructed. v7.47.1 preserves detached canonical intervals at those
boundaries without persisting a parallel source projection. Cache reuse, frozen
retry and consumer mutation tests cover that correction.

# Evidence

## Fixed native-usage comparison

Exactly 24 synthetic text requests were fixed before implementation: Chinese,
English, code, HTML, JSON, RSS, mixed text and tool output, each at 1, 32 and 512
repetitions. Every input was sent once. Original and new algorithms were compared
offline against the same native usage; none of these requests were rerun or
removed. The committed upstream report contains all 24 rows with original
distribution, original budget, new content plus framing, new budget, reserve,
native usage and error:

[Floret v7.47.1 fixed-sample report](https://github.com/floegence/floret/blob/v7.47.1/scripts/context-qualification/REPORT.md).

| Absolute relative error | Median | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Original category sum | 37.921% | 218.842% | 268.551% |
| Original safety budget | 16.729% | 53.366% | 81.686% |
| New content plus protocol framing | 0.568% | 2.062% | 2.116% |
| Acceptance target for content | 5% | 10% | 15% |

All 24 meet the predeclared content-error targets. These are complete-request
errors, not proof that each category equals an undisclosed provider category.
Category correctness is verified using tokenizer references and disjoint typed
source intervals. Protocol framing is estimated independently; no native gap
is assigned to it. The official DeepSeek tokenizer/template provenance and the
template/model-version limitation remain documented upstream. No causal
percentage is inferred from the original screenshot or attributed additively
to overlapping defects.

## Real DeepSeek Flash execution

Qualification used a private temporary copy of the machine's existing DeepSeek
Flash configuration. The user's active provider selection was not changed.
Credentials and raw user state are not committed.

The real multi-turn runtime lane passed in 16.16 seconds, covering repository
rules and skill catalog attribution, code repair, long terminal output with
one execution plus read continuation, restart recall, structured user-input
resume and read-only behavior. A subsequent source-preservation fix justified
the final runtime run; it was not repeated to select a favorable result.

The full final compaction batch ran each of four fixed scenarios once. Keep its
original result: small-history and manual passed; automatic and configured-window
automatic were marked failed by a new test oracle that incorrectly demanded
token estimates after opaque reasoning was retained. Their model tasks and
recall completed successfully. The product correctly returned relative weights.
The oracle now accepts both supported quality values. The same four persisted
states were then read through the public service using an invalid provider URL,
without sending, retrying or replacing any model call: all four source, terminal
state and recall checks passed. The two original failed reports remain failed.

| Scenario | Native input before | Native input after | Readback quality |
| --- | ---: | ---: | --- |
| Small history | N/A | N/A | token_estimate |
| Manual compaction | 121,464 | 51,911 | token_estimate |
| Automatic compaction | 191,427 | 51,191 | relative_weight |
| Configured-window automatic | 541,548 | 51,280 | relative_weight |

Local evidence is retained in /tmp/floret-context-baseline-20261016,
/tmp/floret-context-comparison-20261016,
/tmp/redeven-context-runtime-final-20261016 and
/tmp/redeven-context-compaction-final-20261016. Readback results are in
/tmp/redeven-context-readback.log. These are local evidence locations, not
portable committed fixtures. The 24 synthetic upstream fixtures are committed.

## Presentation and regression coverage

The original fixed-request measurements above remain historical evidence.
The superseded v7.55.0 [presentation contract](../ai/flower-managed-model-context.md#presentation)
uses Floret v7.55.0 request accounting: no proportional allocation, mixed-unit
categories or aggregate-error threshold qualifies attribution. Valid estimated
categories retain their values and a separate Unattributed row accounts for
unobserved input. Legacy categories are unavailable; their measured totals remain.
These rules supersede the previous display behavior without rewriting its recorded
provider results or treating whole-request accuracy as category accuracy.

System tool definitions, MCP tool definitions, tool execution outputs, skill
catalog, rule files and environment retain explicit names. Disclosures are one
level deep with flat horizontal bars. Escape, outside clicks, narrow layouts,
live updates and focus recovery are covered in browser tests across English,
Chinese, light/dark themes and all ten locales. Thread-switch, reconnect, fork
and current-snapshot tests continue to use canonical request identities.

Validation includes the affected Go packages (AI, appserver, threadstore and
boundarycontract), deterministic provider protocols, frozen payload identity,
tool media, invalid optional attribution, mapper quality, shared presentation,
indicator, recovery, localizations, Env App/Desktop TypeScript, source lint,
published Floret dependency boundaries, live protocol and generated OKF checks.
Floret's complete Go suite, v7 compatibility, candidate and published-release
adoption checks passed before release. Normal Redeven commit hooks are required.
The Redeven push gate is intentionally excluded and no Redeven code is pushed.

## Request accounting qualification, 2026-10-18

Published Floret v7.55.0, commit 86e30ca, owns reconciliation and usage
normalization. Concurrent upstream work had already occupied schema 21, so the
accounting migration is the contiguous 21 to 22 edge. It preserves historical
entry bytes and every earlier migration. Redeven uses the published module
with GOWORK=off, without a local workspace, replacement or dependency overlay.

Sanitized screenshot and official-account fixtures retain their native totals
and visible categories, including 18,363 visible versus 46,292 measured input.
The 27,929 remainder stays unattributed; it is neither assigned to tools nor
evidence that the tokenizer has a 60.33% error. Fixed tool definitions keep
their original estimates as native input grows. Regression tests cover zero,
missing and inclusive reasoning usage, partial coverage, legacy units, invalid
details, categories exceeding totals and shared stream/final normalization.

The task-owned production Runtime qualification uses the built Env App,
verified ReDevPlugin v3.0.35 companions, Playwright Chromium and an isolated
deterministic OpenAI Responses SSE endpoint. It uses a synthetic qualification
key, never a user's credential or production state. The fixture reports
90,000 input, 18,000 cached input, 40 output including 20 reasoning, and
90,040 total tokens. This verifies integration and interaction, not live
provider tokenizer accuracy. The maintained runner is
[checkFlowerContextAccountingRuntime.mjs](../../internal/envapp/ui_src/scripts/checkFlowerContextAccountingRuntime.mjs).

The final run passes five scenarios: one confirmed sample owns the total,
categories and 20% recent cache rate during a newer estimate; Stop preserves
that sample and releases the composer; missing usage and an explicit provider
failure retain it and user Retry reply installs the next confirmed sample;
canonical reload preserves categories with keyboard/mouse close and focus
return at 360px width; Runtime restart preserves the exact canonical confirmed
sample. Real interaction exposed mouse activation and Escape ownership gaps;
the panel now owns focus after activation and Escape does not close its outer
conversation window. Browser Mode independently passes all 15 focused tests,
including local projected placement, locale layouts and changing attribution.

Final evidence is retained locally at
/Volumes/JianDisk/.codex-cc/artifacts/flower-context-accounting-20261018.
It contains the runtime report, screenshots and validation logs, excluding
credentials and runtime state. Earlier failed qualification runs remain failed
in their original /tmp/redeven-context-accounting-e2e/run-* directories.

Validation results:

- Floret: complete Go tests, vet, focused race, v7 API baseline, candidate
  adoption and public-proxy published adoption pass. Vulnerability analysis
  finds zero reachable/imported vulnerabilities and five in required but
  uncalled modules. The live online-count qualification was not run. The
  credentialed SQLite example cannot run without OPENAI_API_KEY; it is not
  reported as passing.
- Redeven: affected AI, threadstore, appserver and boundarycontract Go tests,
  vet and focused accounting race pass. Dependency/protocol/generated-artifact
  and OKF checks, Env App/Desktop type checks, production UI builds, changed
  source lint, localization and focused Node/Browser tests pass. A broader
  shared Flower run passes 810 tests.
- Broader qualification is not all green: five Node failures, six Browser
  failures and three unused-import lint errors are independently reproduced
  on the unchanged b6317fd4e baseline archive. Node failures concern stale
  Back to chat lookups and Code export mocks; Browser failures concern
  companion dialog mode, subagent floating geometry and a hardcoded tool-icon
  count. The lint errors are unused spawn imports in the existing canvas
  editing, group-layout and relation qualification scripts. These unrelated
  failures remain visible and are not counted as passes.
- Normal commit hooks run. Redeven's push gate and its component groups are
  deliberately not executed; Redeven main and feature branches are not pushed.

# Boundaries

This evidence applies to the fixed synthetic inputs and recorded real tasks. It
does not establish exact provider category counts or certify other providers
through live calls. Other protocols are covered by deterministic request tests.
Credentials and private runtime state stay outside maintained source.

Earlier unrelated prompt qualification remains **119/120**, including its
remaining failure. This report does not certify that prompt lane as all passed.

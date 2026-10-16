---
type: Qualification Evidence
title: Flower context distribution qualification
description: Fixed native-usage comparisons, real DeepSeek tasks and presentation evidence for published Floret v7.47.1.
tags: [flower, context, deepseek, qualification]
timestamp: 2026-10-16T00:00:00Z
---
# Summary

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

The displayed total prefers native usage. Its content distribution comes from
the same request. Matching vocabulary plus complete text permits approximate
token amounts and shares. Media, opaque inputs or unmatched vocabularies show
shares throughout visible text, titles and accessibility labels. Legacy samples
show explicitly historical shares; absent samples show no distribution.
Top-level shares use all content weights; child shares use their own group.

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

Earlier unrelated prompt qualification remains **119/120**, including its
remaining failure. This report does not certify that prompt lane as all passed.

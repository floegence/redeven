---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Keep one Flower introduction separate from runtime facts, capabilities and native engine guidance.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-21T00:00:00Z
---
# Summary

Flower's host-owned base system prompt contains only its Chinese introduction as
Redeven's general assistant. Every run profile uses the same introduction.
Runtime facts, tool definitions and native Floret guidance retain their own owners
and remain available independently of the product identity.

# Contract

`internal/ai/prompt_builder.go` is the sole source of the base system prompt. It
introduces Flower and its software engineering, device use, information analysis,
question answering, planning and creative scope. It adds no task modes, workflow
policies, tool tutorials or persona-specific execution requirements.

Run profiles remain capability metadata for interactive, autonomous and delegated
execution; they do not select different identity text. `runToolSurface` continues
to select permission-filtered tools and control signals. Operation schemas,
authorization, approvals and cancellation remain enforced by the existing tool
and published Floret runtime contracts. Guidance is not moved into tool
definitions to replace the removed system policies.

Current directory, local date, timezone, permissions, skill catalog and rule-source
manifests remain managed context facts. They do not enter the base system prompt.
Manifests describe rule paths, scope and readability without loading their contents.
Discovery checks symlinks and Git boundaries; incomplete discovery and context
overflow fail admission rather than silently clipping facts. Earlier admitted
context remains immutable, and a corrected request can retry with the same identity.

Floret can append native Goal guidance to the final provider instructions. The
one-introduction contract applies to Redeven's base prompt, not to that independent
engine-owned addition. There is no separate social or creative prompt path.

# Acceptance

Deterministic tests require the exact introduction across all 18 permission,
profile and allowlist combinations. Immutable definition hashes guard against
changes to the provider-visible tools. The base prompt has a 200 UTF-8 byte cap;
byte counts are not provider token measurements.

Service integration tests inspect actual provider requests, including live
permission changes and queued work. They verify the introduction, current managed
facts, normal completion, structured input resume, Goal operation and tool
execution. Rules, skills and runtime facts retain their independent admission and
refresh tests. Provider sampling uses the same production base prompt.

`scripts/check_flower_prompt_deepseek.sh` remains an opt-in paid qualification
lane. Synthetic receipts never execute proposed tools; the Service lane runs
inside disposable state. Freeze inputs and retain requests, responses, receipts,
usage and unresolved semantic reviews. Skipped paid runs are not new model
qualification, and historical scores do not establish quality for this prompt.

# Historical Qualification

On 2026-10-20, the earlier 78/93 versus 86/93 claim was withdrawn: reasonable
inspection was wrongly failed, including in Service. The earlier terminal defect
was real: promised observation without a call, not a wrong cursor or relaunch.
Retained diagnostics also exposed shell-classifier, exact-English matching and
ERROR-prefix receipt-decoding defects.

Final sampling retained 99 responses each. Shared offline scoring: baseline
83 pass / 1 fail / 15 review; candidate 84 / 2 / 13 before manual adjudication.
Candidate failures: three questions despite one-at-a-time instruction; screenshot
reference treated as local image path. Baseline failure: malformed tool output.
Manual review finds two baseline source reads before rules returned. Discovery
and Git metadata reads are legitimate. One blocked-rule response remains
inconclusive; candidate runtime inventory relevance is unproven, not a write.

Both retained Service traces satisfy execution checks after receipt repair: no
consultation edits/Goal, workflow evidence, repair, process/cursors, restart,
structured input and readonly execution. This is replay assessment, not a newly
passing model run. Semantic review still finds both versions interpreting “not
required” as prohibition, plus one candidate answer inverting directory-rule
precedence. Keep these quality failures; neither sample proves reliable behavior,
overall improvement or token savings. Source hashes stayed unchanged; copied
credentials and overlays were removed.

# Boundaries

Redeven owns Flower's product identity and tool adaptation. Published Floret owns
canonical interaction, approval, cancellation, context validation, Goal and
recovery. The identity change adds no upstream API, tool schema, storage migration,
rule loader or parallel lifecycle.

# Evidence

- redeven:internal/ai/prompt_builder.go — The shared introduction.
- redeven:internal/ai/prompt_profiles.go — Capability profile selection.
- redeven:internal/ai/run_tool_surface.go — Permission-filtered tools and base prompt.
- redeven:internal/ai/prompt_consistency_test.go — Exact identity and immutable definition matrix.
- redeven:internal/ai/model_gateway_prompt_context_test.go — Stable identity with changing runtime facts.
- redeven:internal/ai/model_context_runtime_integration_test.go — Real provider requests and current facts.
- redeven:internal/ai/thread_permission_admission_test.go — Live permission changes and queued work.
- redeven:internal/ai/floret_ask_user_integration_test.go — Natural completion and structured input resume.
- redeven:internal/ai/prompt_rule_sources_test.go — Complete rule-source discovery.
- redeven:internal/ai/prompt_context_admission_test.go — Context overflow and same-identity retry.
- redeven:internal/ai/prompt_qualification_test.go — Provider sampling and retained scoring.
- redeven:internal/ai/prompt_runtime_qualification_test.go — Isolated Service execution.

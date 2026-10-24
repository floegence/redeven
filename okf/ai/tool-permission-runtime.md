---
type: AI Tool Contract
title: AI tool permissions and dispatch
description: Tool registration, scheduling, permission, readonly, and target-routing contracts.
tags: [ai, tools, permissions, dispatch]
timestamp: 2026-10-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

Redeven owns product visibility, presentation, current permission policy, prompt, and approval UX; Floret owns invocation and product-neutral tool implementations. Saved thread permission applies at the next authorization boundary within the same task, including queued work, continuation, retry and restart. Each prepared invocation keeps its own snapshot through approval and execution. Missing or invalid authority fails closed. Ordinary calls in one model response enter authorization together and may execute concurrently; dependent work waits for a later response.

# Contract

Default Flower tools omit write_todos; historical Todo results remain readable. The Floret-native goal tool has independent control ownership; see [Flower Goals](flower-goals.md).

## Mechanism
The registry includes readonly file/search helpers, standard mutation, patch, terminal, web search, OKF, interaction, skill, subagent, MCP, and Floret-native tools. Structured detail uses Floret's bounded typed rows; operation, status, repeated names, and raw tool fields never create an expand affordance.

The resolver validates MIME, size, and digest through the target-owned media store; it never stores image bytes in durable tool state.

## File editing

The active Flower patch executor belongs to Redeven. Local file edits use the
filesystem registry; patch source and move destinations additionally remain
inside the run working directory after canonical resolution. Relative and
absolute spellings are accepted. Existing symlinks and new-file ancestors resolve
before approval, and execution checks the approved canonical targets again.
Readonly roots cannot be written. Target-routed tools retain target-owned policy.

Use file.edit for small unique literal replacements, file.write for complete
files, and apply_patch for multi-chunk or multi-file changes. The current provider
surface uses one strict JSON input argument plus declared routing fields; patch
and input_format are not accepted aliases. No endpoint is assumed to support
freeform grammar based on its model name.

Chunks search original content forward, preserving anchors, EOF and numeric
ranges. Only an order failure permits reordering: every chunk must have one
exact, non-overlapping original-source match, without anchors, ranges, EOF markers
or pure additions. The same matcher and write plan apply sorted chunks; accepted
forward patches and recorded arguments remain unchanged. Ambiguity or unsupported
chunks retain the original rejection. The provider still requests source order.

Pure additions append. Untouched lines retain their endings; insertions use the
first ending (LF for empty files), and nonempty updates retain a final newline.
Exact matching precedes whitespace and punctuation normalization. Explicit Add
and Move may replace regular files. Use one operation per canonical path.

Rejection diagnostics distinguish order, overlap, anchor, EOF, repeated context,
missing text and duplicate-path failures. They report the chunk, patch-body line,
search boundary and exact source line when available, with a repair instruction.
Diagnostics do not select writes; strict JSON validation remains in Floret.

All plans validate before writing and recheck source and destination snapshots
before each commit. Validation errors confirm no writes. Filesystem commit errors
report completed file operations and uncertain effects; they never authorize
blind replay. Single-file replacement is atomic, but a multi-file patch is not a
filesystem transaction. Model success retains confirmed paths and counts; actual
before/after diffs and format metadata remain in canonical Activity presentation.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.

- `redeven:internal/ai/floret_tools.go:91` - Redeven projects host builtins and selects the direct Floret-native path.

- `redeven:internal/ai/floret_native_tools.go` - The unique native factory derives `web_fetch` from Floret and binds invocation product permission.

- Redeven patch implementation: internal/ai/unified_diff_apply.go, patch_text.go and patch_tool.go.
- Deterministic tests: patch_correctness_test.go, patch_order_test.go, patch_diagnostics_test.go, patch_tool_test.go and patch_runtime_test.go cover ordering, zero-effect rejection, endings, authorization, commit failures, provider schemas and unchanged history after restart/Fork.
- Synthetic live-model cases in internal/ai/patch_prompt_qualification_test.go check multi-chunk construction, ordering recovery and duplicate-header recovery. They use the configured isolated prompt qualification lane and only evaluate proposed patches in memory; they never execute model-proposed tools. A small passing sample does not establish a production failure rate.

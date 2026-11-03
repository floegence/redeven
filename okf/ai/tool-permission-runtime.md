---
type: AI Tool Contract
title: AI tool permissions and dispatch
tags: [ai, tools, permissions, dispatch]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven owns product visibility, policy, prompt and approval UI; Floret owns invocation and neutral tools. Current thread permission applies at the next boundary, while each admitted call retains its snapshot. Ordinary independent calls may authorize together; invalid authority rejects and dependent work waits.

# Contract

Default tools omit write_todos; historical Todo remains readable. [Goals](flower-goals.md) retains independent ownership. Registry includes read/search/file/patch/terminal/web/OKF/interaction/skills/subagents/MCP/Floret tools. Bounded typed details exclude raw/status/name-only affordances. Target media validates MIME/size/digest; never persist image bytes in tool state.

## Diagnostic ownership
Classify owner-typed/cancel/deadline/filesystem errors; unknown wording stays UNKNOWN/source text. Keywords cannot infer resource, authority, retry or replacement args. Owners resolve authorized relative/home paths. Keep patch diagnostics; removing unused suggested-fix inference proves no model-quality gain.

## File editing
Redeven patch cwd resolves relative paths only; registry owns canonical/logical write policy, including authorized external/current scratch roots. Deny readonly/sibling/ancestor/symlink escapes. Target tools retain target policy.

Resolve symlinks/new-file ancestors before authorization. Ordered canonical resource sequence rejects swapped/changed targets. Preserve submitted paths and resolve at full preflight, each commit and Move source deletion; source/destination snapshots must match. This is not an OS sandbox or elimination of all TOCTOU races.

file.edit=unique literal replacement, file.write=whole file, apply_patch=multi-chunk/file. Strict JSON/routing has no input_format/patch aliases; model name implies no freeform support. Search original source forward with anchors/EOF/ranges. Only order failures may reorder uniquely exact/nonoverlapping chunks without anchors/ranges/EOF/pure additions, using the same matcher/plan. Preserve original arguments/classifications; ambiguous chunk requests unique context, provider still requests source order.

Pure additions append. Untouched endings remain; insertions use first ending (empty=LF); nonempty updates retain final newline. Match exact, then trailing/surrounding whitespace, then selected Unicode normalization, first permitted match. Context copies source; insertions literal, no reindent. Add/Move may replace regular files; one operation/canonical path.

Diagnostics name order/overlap/anchor/EOF/context/duplicate path with chunk/body-line/search boundary/exact source line/remedy; never choose writes. Floret validates JSON. Validate all before writing and snapshot-check each commit. Validation failure confirms no writes; commit failures preserve completed operations/unknown effects without replay permission. completed_files means whole operation. Activity retains confirmed paths/counts/full actual diff; model omits full diff and may inspect content. A Move whose destination succeeds but deletion fails reports destination create/update against its prior bytes, not completed rename. Atomicity is per-file, not patch/Move. Published ordered-resource/EffectOutcome/PatchActivity owns authorization/settlement/persistence.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - Source.
- `redeven:internal/ai/floret_native_tools.go` - Source.

- Patch sources/tests in internal/ai/: unified_diff_apply.go, patch_text.go, patch_tool.go; patch_{correctness,order,diagnostics,scope,tool,runtime}_test.go cover ordering, no-effect rejection, endings, authorization, commit errors, schemas and restart/Fork history.
- internal/ai/patch_prompt_qualification_test.go uses the isolated live-model lane for multi-chunk, order and duplicate-header recovery. Patches run only in memory; proposed tools never execute. Small samples do not establish production failure rates.

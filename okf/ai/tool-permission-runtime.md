---
type: AI Tool Contract
title: AI tool permissions and dispatch
tags: [ai, tools, permissions, dispatch]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Redeven owns product visibility, presentation, current permission policy, prompt, and approval UX; Floret owns invocation and product-neutral tool implementations. Saved thread permission applies at the next authorization boundary within the same task, including queued work, continuation, retry and restart. Each prepared invocation keeps its own snapshot through approval and execution. Missing or invalid authority fails closed. Ordinary calls in one model response enter authorization together and may execute concurrently; dependent work waits for a later response.

# Contract

Default Flower tools omit write_todos; historical Todo results remain readable. The Floret-native goal tool has independent control ownership; see [Flower Goals](flower-goals.md).

## Mechanism
The registry includes readonly file/search helpers, standard mutation, patch, terminal, web search, OKF, interaction, skill, subagent, MCP, and Floret-native tools. Structured detail uses Floret's bounded typed rows; operation, status, repeated names, and raw tool fields never create an expand affordance.

The resolver validates MIME, size, and digest through the target-owned media store; it never stores image bytes in durable tool state.

## Diagnostic ownership

Error classification uses owner-typed errors and standard cancellation, deadline
and filesystem causes. Unknown wording remains UNKNOWN with its source message;
keywords never infer a resource, authorization, retry safety or replacement
arguments. Filesystem and terminal owners still resolve authorized relative and
home-relative paths before dispatch. Owner-generated patch diagnostics remain
available. Ordinary final error payloads never included generic suggested fixes;
removing that unused inference is not evidence of improved model decisions.

## File editing

Redeven owns Flower patch execution. cwd only resolves relative input paths;
the filesystem registry owns logical/canonical write policy for every local
patch and Move endpoint, including authorized roots outside cwd and the current
thread's private scratch. Readonly roots, private siblings/ancestors and their
symlink aliases remain denied. Target-routed tools retain target-owned policy.

Symlinks and new-file ancestors resolve before Floret authorization. Execution
compares the ordered canonical resource sequence, rejecting swapped destinations
as well as changed targets. Plans retain submitted paths and re-resolve them at
full preflight, before each file commit and before Move source deletion. Source
and destination snapshots must still match. These checks do not eliminate every
filesystem TOCTOU race or constitute an OS sandbox.

Use file.edit for unique literal replacements, file.write for complete files,
and apply_patch for multi-chunk/file changes. Its strict JSON input argument and
declared routing fields have no patch or input_format aliases. Model names never
imply endpoint support for freeform grammar.

Chunks search original content forward, honoring anchors, EOF and numeric ranges.
Only order failures allow reordering: every chunk needs one exact, non-overlapping
match, without anchors, ranges, EOF markers or pure additions. Sorted chunks use
the same matcher and write plan. Forward patches, recorded arguments and rejection
classifications remain unchanged. Ambiguity names the blocking chunk and requests
unique context. The provider still requests source order.

Pure additions append. Untouched lines retain their endings; insertions use the
first ending (LF for empty files), and nonempty updates retain a final newline.
Matching tries exact lines, then trailing-whitespace, surrounding-whitespace and
selected Unicode punctuation/space normalization, returning the first match in
each permitted search pass. Context copies original source text; inserted text
is literal, with no automatic indentation. Explicit Add
and Move may replace regular files. Use one operation per canonical path.

Diagnostics distinguish order, overlap, anchor, EOF, repeated/missing context and
duplicate paths, with chunk, patch-body line, search boundary, exact source line
when available, and a remedy. They never select writes. Floret validates JSON.

Plans validate before writing and recheck source/destination snapshots per commit.
Validation errors confirm no writes; commit errors report completed operations
and uncertain effects, never permission to replay. completed_files retains whole
operation completion semantics. Partial result data and canonical Activity carry
only confirmed mutations, paths, counts and actual before/after diffs. The full
diff is retained in Activity and omitted from the model payload; the model can
inspect affected content when verification requires it. If a Move
writes its destination but cannot delete its source, report the destination's
create/update diff against its own prior contents, not a completed rename.
Replacement is atomic per file, not per patch or Move. The existing published
Floret ordered-resource, EffectOutcome and typed PatchActivity contracts own
authorization, settlement and persistence; no second lifecycle is introduced.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.

- `redeven:internal/ai/floret_native_tools.go` - The unique native factory derives `web_fetch` from Floret and binds invocation product permission.

- Patch sources/tests in internal/ai/: unified_diff_apply.go, patch_text.go, patch_tool.go; patch_{correctness,order,diagnostics,scope,tool,runtime}_test.go cover ordering, no-effect rejection, endings, authorization, commit errors, schemas and restart/Fork history.
- internal/ai/patch_prompt_qualification_test.go uses the isolated live-model lane for multi-chunk, order and duplicate-header recovery. Patches run only in memory; proposed tools never execute. Small samples do not establish production failure rates.

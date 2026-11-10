---
type: AI Tool Contract
title: AI tool permissions and dispatch
tags: [ai, tools, permissions, dispatch]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven owns visibility/policy/prompts/approval UI; Floret owns invocation and neutral tools. Retired Todo remains readable but unavailable; [Goals](flower-goals.md) retains its own owner. File inspection shares current scope across modes. Typed validation precedes dispatch and never authorizes replay.

# Contract

Typed details exclude raw/status/name-only affordances. Validate media MIME/size/digest without storing bytes in tool state. Typed decoders validate conditional inputs before resource resolution/authorization. Published Floret owns bounded correction and paired feedback; reuse [child validation](subagent-runtime.md). Projector failures stay contract failures; business/permission/storage errors never imply safe replay.

## Model-visible guidance
First-party names follow lowercase ASCII <domain>_<action>[_object], single underscores and <=64 characters. Registration/final preparation reject invalid/duplicate names; priority never replaces handlers. [Historical spelling](../../internal/ai/toolnames/migration.json) maps only released names; names.go reserves current first-party additions without invented migrations. Reserve mcp_; MCP uses 192 bits of the exact released capability digest, retaining display labels.

Definitions/dispatch/observation/transports share names, without advertised aliases. Hosted provider tools and JavaScript methods retain separate contracts. Strict-schema null-to-omit affects only adapter-added nullable fields. Frozen retries keep bytes.

Published Floret names Goal/input goal_manage/user_ask. Exact explicit allowlists constrain these built-ins; unattended input is separately disabled. Product schema 12→13 migrates exact execution Options.tool_allowlist values, deriving MCP identities without current server configuration. Journals, signatures/effects, user/script text and native history retain original bytes/spelling. Read-only presentation maps history; search bindings retain service. Restart pairs known-undispatched calls with canceled receipts under original identity; new work reauthorizes. No aliases or automatic replay.

[Budget tests](../../internal/ai/tool_definition_budget_test.go) pin final HTTP membership/bytes with ~3–4% allowance, no description truncation. Full/readonly/Computer-disabled/plugin fixtures include controls, attachments and Goal; search/MCP remain unconfigured. Computer defaults to three tools, historical primitives separate.

## Diagnostic ownership
Typed owner/cancel/deadline/filesystem classifications survive; unknown wording stays UNKNOWN. Keywords never infer resources, authority, safety or replacement arguments. Missing error data is not encoding loss. Owners resolve authorized relative/home paths. Removing heuristics alone proves no quality gain.

## File inspection
file_read/file_read_many/path_find are read-only across modes, retaining session read and filesystem policy; admission requirements remain separate. file_search remains readonly-only, with no aliases.

file_read uses Registry.OpenRead and complete UTF-8 lines: 1-based offset (omitted/0=1), default 200/max400, <=8,000 content bytes/24KiB escaped JSON. Exact line_offset/count and next_offset report continuation; total_lines stays unknown until EOF (empty=0). No whole-file rejection/tail scan. Prefix scanning stops at64MiB with cancellation. Oversized lines, invalid UTF-8/NUL fail without partial cursors/fallback; every call reads current bytes.

file_read_many accepts50 paths/default120 lines and <=32KiB encoded items. Errors are per-file; next_index is submitted zero-based index. Individual continuation uses file_read. Preserve executor coordinates/content in model projection; Activity is separate.

path_find.name is a basename glob (*,?,classes), not relative path. Reject malformed patterns; hidden defaults off, no symlink following/gitignore. Bound default200/max1000 results, default8/max32 depth (0=default),10,000 entries,5s,32KiB. Truncation means incomplete; narrow before concluding absence.

## File editing
Product resolves cwd; registry owns logical/canonical write policy including authorized external/scratch roots. Reject readonly/sibling/ancestor/symlink escape independently of target policy. Resolve existing/new-file ancestors before approval. Preserve submitted paths; ordered canonical resources/snapshots reject swaps at preflight, every commit and Move deletion. This is neither OS sandbox nor elimination of TOCTOU.

Only file_write/full contents and file_apply_patch/contextual add/change/delete/move execute. No literal replacement/input_format alias/implied freeform protocol; historical calls and target navigation stay readable.

Forward matching uses anchors/EOF/ranges. Only order failures may reorder unique exact nonoverlapping chunks without anchors/ranges/EOF/pure additions, through the same matcher/plan. Ambiguity requires unique context; providers still request source order. Pure additions append. Preserve untouched endings; insertion uses first ending (empty=LF), nonempty updates retain final newline. Match exact, then whitespace, then supported Unicode normalization at first allowed match; never reindent literals. Add/Move may replace regular files; one operation/path.

Diagnostics retain order/overlap/anchor/EOF/context/duplicate path, chunk/body-line, search boundary/source line and remedy, never choose writes. Validate all before writing; snapshot-check each commit. Validation proves no writes; failure retains completed operations and uncertainty. completed_files means complete operations. Activity owns full actual diff/paths/counts; model omits diff and may inspect. Destination success/source-delete failure is create/update against prior destination, not rename. Atomicity is per-file, never whole patch/Move. Published ordered resources/EffectOutcome/PatchActivity own authorization/settlement/history.

# Boundaries

OKF is embedded project knowledge, not internet; external/current/news/market facts require authoritative URLs/search. Search/fetch configure independently; known-URL fetch cannot imply search. Remote execution needs explicit tool/command provenance, not thread context.

# Evidence

File-window/Service tests cover bounded JSON, escaping, UTF-8/EOF/batches, scope, all modes, Activity/restart. Local feedback/integration and patch correctness/order/diagnostics/scope/runtime tests cover no-effect correction, partial commits/Fork/restart; live proposal fixtures never execute writes. Naming/history tests cover final provider mappings, original signed/paired histories, pending input/approval, Fork/Retry and no replay on published Floret.

November8 baseline16f0a9854 retained37 tools with smaller JSON; DeepSeek baseline9/9 versus candidate8/9 retained a cancellation-count error. Subagent compression was withdrawn; no quality gain claimed. Tessiven isolation later added three shared reads (24→27), increasing bytes with unchanged system prompt. Bytes are not tokens/latency/success. REDEVEN_FLOWER_PROMPT_PROVIDER_ID selects qualification profiles only.

Isolated 680-thread schema12→13 public-API inspection retained334 configurations unchanged (no allowlists). Synthetic fixtures test renaming/rollback. Source Runtime was not upgraded; prior timeout enabled execution before correction, so this is readability evidence, not full-copy byte preservation. Git retains exact metrics and source identities.

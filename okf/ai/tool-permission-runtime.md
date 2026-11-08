---
type: AI Tool Contract
title: AI tool permissions and dispatch
tags: [ai, tools, permissions, dispatch]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven owns product visibility, policy, prompts and approval UI; Floret owns invocation and neutral tools. Default tools omit write_todos; historical Todo stays readable. [Goals](flower-goals.md) retains independent ownership. File inspection is shared across modes within current scope.

# Contract

Typed details exclude raw/status/name-only affordances. Media validates MIME/size/digest; never persist image bytes in tool state.

Pure conditional-input validation belongs in typed tool decoders, before resource
resolution and effect authorization. Published Floret owns bounded correction and
paired model feedback; Redeven reuses its existing [child action validator](subagent-runtime.md).
Projector failures remain contract failures; permission/storage/business failures
retain owner classifications and never imply safe replay.

## Model-visible guidance
Redeven owns provider-name mapping and strict-schema omission. Keep one short
mapping per renamed tool; never rewrite prompt/history literals. Null-to-omit
applies only to adapter-added nullable fields; native nulls remain values. Frozen
transport retries replay identical bytes. Document identity/action contracts once,
in the owning tool or parameter.

[Budget tests](../../internal/ai/tool_definition_budget_test.go) measure final
permission-filtered HTTP tools, pin membership and allow about 3-4% growth without
runtime description truncation. Fixtures cover full-access, readonly, Computer
disabled and plugin creation, including controls, attachments and Goal. Search/MCP
are unconfigured. Computer defaults to three tools; historical primitives remain
separate.

## Diagnostic ownership
Owner-typed, cancellation, deadline and filesystem errors retain classifications;
unknown wording stays UNKNOWN. Keywords cannot infer resources, authority, retry
safety or replacement arguments. Missing result data on an error is not encoding
loss. Authorized relative/home paths resolve at the owner. Removing heuristic diagnostics alone proves no quality gain.

## File inspection
`read_file`, `read_files` and `find` are shared read-only tools in every Flower mode.
Session read permission and current filesystem scope remain mandatory; thread
admission retains its separate session requirements. Published Floret APIs suffice.
`rgrep` stays readonly-only; no read/glob/list-directory alias is added.

`read_file` streams complete UTF-8 lines through `Registry.OpenRead`. Offset is
1-based (omitted/0=1), default 200/max 400 lines, capped at 8,000 content bytes and
24 KiB JSON-escaped content. Returned `line_offset`/`line_count` are exact;
`next_offset` continues when `truncated`. `eof` is observed; `total_lines` is unknown
until EOF (empty=0). No whole-file rejection or tail scan. Prefix scans
stop at 64 MiB and honor cancellation. Oversized lines, invalid UTF-8 and NUL data
fail explicitly without partial-line cursors or automatic fallback. Calls read current bytes, not snapshots.

`read_files` accepts 50 paths, defaults to 120 lines/file and bounds encoded items
to 32 KiB. Errors stay per-file. `next_index` is the submitted paths' next 0-based
index; individual files continue through read_file. Model projection preserves
executor-bounded content/coordinates; Activity remains a separate presentation.

`find.name` matches basenames with `*`, `?`, character classes, never relative-path
globs. Malformed patterns fail. Hidden entries default off; no symlink following
or gitignore. Scope, default 200/max 1000 results, default 8/max 32 depth (0=default),
10,000 visited entries, 5 seconds and 32 KiB encoded items bound discovery.
Truncation/scan facts mean incomplete results; narrow the query before concluding
absence.

## File editing
Redeven resolves patch cwd; registry owns logical/canonical write policy, including
authorized external/scratch roots. Deny readonly/sibling/ancestor/symlink escapes;
target policy stays separate. Resolve symlinks/new-file ancestors before approval.
Preserve submitted paths; ordered canonical resources and snapshots reject swaps
at preflight, each commit and Move source deletion. This is not an OS sandbox or
elimination of all TOCTOU races.

Only `file.write` (complete contents) and `apply_patch` (contextual single/multiple
file changes, creation, deletion, moves) execute. No literal-replacement tool,
input_format/patch alias or implied freeform protocol. Historical calls/results
and typed target navigation remain readable without restoring execution.

Search forward with anchors/EOF/ranges. Only order failures may reorder uniquely
exact nonoverlapping chunks without anchors/ranges/EOF/pure additions, using the
same matcher/plan. Preserve arguments/classifications; ambiguous chunks require
unique context, and providers still request source order. Pure additions append.
Untouched endings survive; insertions use first ending (empty=LF), nonempty updates
retain final newline. Match exact, trailing/surrounding whitespace, then selected
Unicode normalization at the first permitted match. Copy context; literal
insertions never reindent. Add/Move may replace regular files; one operation/path.

Diagnostics include order/overlap/anchor/EOF/context/duplicate path, chunk/body-line,
search boundary/source line and remedy; never select writes. Floret validates JSON.
Validate all before writing and snapshot-check every commit. Validation confirms
no writes; commit failure retains completed operations/unknown effects without
replay permission. completed_files means whole operations. Activity retains paths,
counts and actual full diff; model omits diff and may inspect content. Destination
success/source deletion failure reports create/update against prior destination,
not rename. Atomicity is per file, not patch/Move. Published ordered-resource,
EffectOutcome and PatchActivity own authorization, settlement and history.

# Boundaries

No aliases restore deleted knowledge tools. OKF is an embedded project corpus, not internet access; external/current/news/third-party/market/pricing/web facts require authoritative URLs or web search.
Search and fetch are independently configured. Published Floret fetch guidance
describes reading a known URL without assuming search is available.

Remote/target execution claims require explicit provenance from a tool result or product command, never thread context alone.

# Evidence

- [File windows](../../internal/ai/file_read_window_test.go): exact bounded provider
  JSON, escaping, large files/lines, UTF-8/EOF, batch continuation, discovery,
  cancellation, scope and authorization. [Service acceptance](../../internal/ai/file_read_service_test.go):
  all modes, HTTP definitions/results, no read approval, Activity and restart on
  published Floret. Read-only dispatch caps do not widen thread admission.
- [Local diagnostics](../../internal/ai/local_tool_feedback_test.go) and
  [Service tests](../../internal/ai/local_tool_feedback_integration_test.go): retired
  calls, no-effect validation, explicit correction, HTTP, Activity and restart.
  [Provider tests](../../internal/ai/model_gateway_tool_names_test.go): name/schema
  guidance and frozen retries. [Registry](../../internal/ai/tools/registry.go): presentation.
- `internal/ai/patch_{correctness,order,diagnostics,scope,tool,runtime}_test.go`:
  ordering/endings/authorization/partial failures/restart/Fork. Live proposals in
  `patch_prompt_qualification_test.go` run in memory, never execute tools; small
  samples do not establish production failure rates.
- 2026-11-08 description baseline `16f0a9854`: 37 tools retained; JSON shrank
  37,465→35,293 bytes (DeepSeek), 45,063→40,515 (strict Responses). DeepSeek Flash
  three repeats/case: baseline 9/9, candidate 8/9 (one cancellation-count error);
  child inspection/service identity each 3/3. Proposed subagents compression was
  withdrawn for inconsistent cancellation interpretation. No model-quality gain;
  strict tests used fake providers.
  `REDEVEN_FLOWER_PROMPT_PROVIDER_ID` selects only qualification profiles.
- After integrating Tessiven scope isolation at `95a8b4b68`, shared inspection adds
  three ordinary full-access tools (24→27): DeepSeek 24,663→26,747 bytes; strict
  Responses 28,354→30,963. Canvas-specific surfaces retain their own inventory.
  System prompt unchanged. Bytes are not tokens, latency or task success.

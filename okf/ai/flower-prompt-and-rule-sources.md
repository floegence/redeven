---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Unify task, interaction and recovery instructions with actual capabilities and complete authorized rule sources.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Flower shares task, interaction and recovery policies across three profiles.
Current tools supply operation semantics; admitted context carries complete facts
and rule-source manifests, without silent clipping or a second lifecycle.
Evidence triggers and task authorization remain explicit.

# Contract

The three profiles share task, interaction and recovery policies; profiles
express persona and interaction differences. The selected `runToolSurface`,
including control signals and Floret's Goal, is the only capability list. Current
authorization governs each call. Sufficient supplied context, subjective feedback
and supplied-text discussion receive direct answers. Requested verification or
missing necessary evidence triggers focused inspection: workspace sources for
code/file claims, authoritative sources for external/current facts. Workflow
rules constrain execution; they never authorize extra edits, commits, pushes or
deployment. Brief consultations omit plans and progress updates. User and
repository restrictions override generic delegation advice.

Runtime manifests list rule paths, scope and readability, never contents. Registry
discovery checks symlinks and distinguishes complete empty results from failed
scans. Identify the target repository/worktree, then completely read applicable
`AGENTS.md`, `CLAUDE.md`, `.develop.md` and `.introduce.md` from root to target
before other repository operations. Discovery and rule reads come first; exclude
unrelated worktrees. Supplied-text discussion does not initiate repository work.
Git roots bound ancestor discovery; non-repositories scan their working directory.
Failed probes reject admission. New worktrees require discovery. Specific rules
override ancestors; conflicts use the interaction policy. Unreadable rules block
affected work while independent work continues.

Floret validates complete context before saving authority. Overflow releases the
send and workload lease, allowing corrected input with the same request identity.
Earlier context stays immutable. Skill catalogs are facts; current capabilities
supply activation advice.

Use `ask_user` for necessary decisions and requested guided questions; ordinary
discussion and optional feedback can use prose. Noninteractive runs report
blockers and recovery conditions. Never duplicate tool approval with a question.
Responses preserves supplied descriptions, including Floret's question contract.

Observe finite commands in the same turn through their existing identity and
cursor. Shared timeout classification preserves partial results and conservative
advice; neither timeouts nor retry hints prove non-execution or authorize replay.
Inspect uncertainty before a new authorized action; unsettled effects remain
terminal. Never bypass denials. Floret bounds schema correction before dispatch
and owns approval, cancellation, restart and [Goal reflection](flower-goals.md).
Default prompts contain no Todo discipline. New actions retain authorization and
repeated-call protection.

The working directory defaults relative paths; filesystem roots and permissions
define access. Authorized sibling worktrees use explicit terminal `cwd`/`workdir`
and absolute file paths. `apply_patch` is confined to the run directory; other
worktrees use `file.edit` or `file.write`. `read_file` retains typed pagination.

Research cites verified URLs. Local and hosted search remain distinct; `web_fetch`
reads known public text sources. Browser fallback handles missing search, confirmed
pre-execution failure or rendering needs, never denial or URL blocking. Replacing
requested GUI work with text research requires user acceptance.

# Prompt Budget And Qualification

System instructions own behavior and boundaries; tool definitions own invocation
semantics, custom APIs, cursors and result shapes. Do not duplicate schemas or
tutorials, or move guidance into definitions to claim system savings. Language,
capability authority and effect recovery each have one owner. Preserve complete
rule reading, approval, Stop, unknown effects, browser identity, observed GUI
verification, finite-command continuation, media and isolated `html preview`.

Byte budgets are deterministic guards, not tokenizer measurements: 11,000 for the
built-in surface, 12,000 for permission transitions including Goal, and 9,849 for
the production fixture (definitions 37,000; combined 47,500). All 18 permission/
profile/allowlist combinations shrink 40 UTF-8 bytes against `b65d82480`, retaining
definition hashes and matching tool guidance. The final Goal-injected fixture
falls from 9,889 to 9,849 bytes; definitions remain 36,683 bytes.

`scripts/check_flower_prompt_deepseek.sh` is an opt-in paid qualification lane. It
reads the selected local DeepSeek provider and its effective `deepseek-flash`
configuration through production parsers, without modifying source state. It
requires a fresh report directory and normally repeats 31 behavior cases three
times. Model-proposed operations in those cases are not executed; synthetic
receipts allow denial, unknown-effect and GUI recovery checks without effects.
Every historical and returned call must satisfy the actual tool schema. The case
manifest governs report completeness. Paired feedback, supplied code and explicit
source-verification scenarios distinguish discussion from repository work; target
and switched-worktree fixtures check rule-first scope. Unreadable rules block
repository work while independent supplied-data analysis can finish.

A separate production Service exercise checks fresh consultations with real Goal
injection, requiring one provider step, no tools and no Goal creation. It performs
code repair and complete rule reading in a disposable project, waits through real terminal continuation,
checks restart recall, resumes a structured answer and reads a file in readonly
mode. It never controls the user's browser or launches subagents. Reports retain
prompt/tool hashes, synthetic inputs, outputs, errors and usage; credentials stay
outside reports. Missing configuration, skipped tests and absent reports fail
qualification. DeepSeek total input includes both cache-miss and cache-read
tokens. Baseline snapshots can be supplied through
`REDEVEN_FLOWER_PROMPT_BASELINE_DIR` for the same fixtures and tool definitions;
failures remain visible rather than being repaired by a test-owned retry loop.
Freeze cases, oracles, prompt sources and repetition count before comparison.
Run each version once with identical tool definitions; retain every result and
compare multi-turn execution as well as routing. Historical or partial passes
never qualify a later candidate. Report system and full provider input separately.
Malformed calls fail qualification. Deterministic tests or isolated execution do
not establish a paid-lane pass.

On 2026-10-20, the frozen 31-case comparison ran three repetitions on each
version with identical inputs, histories and tool hashes: baseline passed 77/93,
candidate 79/93. Both failed qualification. Rule discussion triggered repository
inspection; rule-first cases scheduled other operations before reading completed.
Both production Service runs answered feedback and supplied-code consultations
without tools or Goals, but inspected the repository for workflow-rule discussion.
Repair, terminal continuation, restart, structured input and readonly checks
completed. Total measured synthetic input was 1,063,976 versus 1,076,333 tokens;
byte savings do not establish provider-token savings or a behavioral improvement.
An earlier retained run exposed two oracle defects (an absent Goal snapshot and
valid parent-report routing); both were corrected before the paired comparison.

# Boundaries

Redeven owns product prompts and tool adaptation. The published Floret runtime owns
canonical interaction, approval, cancellation, context validation and recovery.
This change adds no public API, tool input shape, storage schema, durable rule
loader, provider checkpoint rewrite or parallel waiting lifecycle.

# Evidence

- `redeven:internal/ai/prompt_builder.go` - One behavior policy with capability-gated operation instructions.
- `redeven:internal/ai/prompt_profiles.go` - Three profiles express role and interaction differences.
- `redeven:internal/ai/prompt_workspace_context.go` - Authorized rule descriptors and complete validated runtime context.
- `redeven:internal/ai/send_user_turn.go` - Complete input validation precedes execution-authority persistence.
- `redeven:internal/ai/prompt_consistency_test.go` - Actual permission, profile and allowlist matrix governs instructions.
- `redeven:internal/ai/prompt_rule_sources_test.go` - Long Unicode rules, complete read pages, discovery failures and worktree authorization.
- `redeven:internal/ai/prompt_context_admission_test.go` - Overflow releases busy state and permits corrected retry without canonical mutation.
- `redeven:internal/ai/floret_ask_user_integration_test.go` - A fresh supplied-prompt analysis completes without tools and accepts follow-up input.
- `redeven:internal/ai/thread_permission_admission_test.go` - Actual provider requests match live permission surfaces.
- `redeven:internal/ai/tools/orchestrator_test.go` - Timeout and denial advice cannot authorize unsafe replay or bypass.
- `redeven:internal/ai/tool_timeout_test.go` - Actual file/Computer dispatch uses shared timeout classification, preserving partial results and one execution.
- `redeven:internal/ai/prompt_qualification_test.go` - Size budget, schema-valid fixtures and real-provider behavior comparison.
- `redeven:internal/ai/prompt_runtime_qualification_test.go` - Isolated real execution, terminal continuation, restart, structured answer and readonly checks.
- `redeven:scripts/check_flower_prompt_deepseek.sh` - Explicit paid qualification with unchanged-source and complete-report checks.

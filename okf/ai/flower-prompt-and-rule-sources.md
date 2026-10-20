---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Unify task, interaction and recovery instructions with actual capabilities and complete authorized rule sources.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Flower uses one task, interaction and recovery policy across its three profiles.
The current tool surface supplies operation instructions; admitted context carries
complete facts and rule-source manifests. Missing capabilities and invalid context
produce concrete recovery conditions without a second lifecycle or silent clipping.

# Contract

The three profiles share task, interaction and recovery policies; profiles
express persona and interaction differences. The selected `runToolSurface`,
including control signals and Floret's Goal, is the only capability list. Current
authorization governs each call. Supplied material can be answered directly;
current file, external and execution claims require evidence. User and repository
restrictions override generic delegation advice.

Runtime context lists rule-source paths, applicable directories and readability,
not bodies or previews. Discovery uses the authorized filesystem Registry and
checks symlinks. Flower completely reads applicable `AGENTS.md`, `CLAUDE.md`,
`.develop.md` and `.introduce.md` before governed work. The manifest distinguishes
completed empty discovery from incomplete scanning and records scanned directories.
Git worktree roots bound ancestor discovery; confirmed non-repositories scan only
the working directory. Missing Git, failed root probes and invalid scope reject
admission through existing recovery. Other worktrees require their own discovery.
Specific directory rules override ancestors; incompatible same-scope rules use
the interaction policy. Unreadable rules or unavailable readers block affected
work while independent work continues.

Floret validates complete runtime snapshots and assembled input before authority
is saved; no host clipping hides rules or skills. Overflow releases the send and
workload lease, permitting corrected input with the same request identity. Earlier
context and checkpoints stay immutable. Skill catalogs are facts; current
capabilities supply activation advice.

Use supplied `ask_user` for necessary decisions and requested guided questions;
ordinary discussion and optional feedback can use prose. Without input capability,
report the blocker and recovery condition to the user or parent. Do not duplicate
tool approval with a question or add a host waiting state. Responses requests
preserve supplied function descriptions, including Floret's question description.

A running command is observed through its existing process identity and cursor;
repeated observations are valid when state may change. Timeouts do not establish
that an effect never executed and do not independently authorize replay. A
returned uncertainty requires inspection before another action; unsettled
runtime effects remain terminal. Denials cannot be bypassed with another tool.
The model corrects schema-invalid arguments from paired validation feedback;
Floret prevents dispatch and bounds regeneration attempts. Approval, cancellation
and restart recovery remain Floret-owned.
[Goal reflection](flower-goals.md) is Floret-owned and appends typed current facts.
Default prompts contain no Todo discipline. Finite commands require another
`terminal.read` in the same turn. New actions retain normal authorization and
repeated-call protection.

The working directory is a relative-path default. Configured filesystem roots
and their read/write permissions define authorization; task scope and repository
rules determine relevant work. Authorized sibling worktrees use explicit terminal
`cwd`/`workdir` and absolute file paths. `apply_patch` remains confined to the run
working directory, so another worktree uses supplied `file.edit` or `file.write`.
`read_file` uses the shared bounded reader and typed pagination. Historical file
actions remain readable without restoring removed tools.

Ordinary research discovers sources, reads and verifies them, and cites exact
verified URLs. Local `web.search` and provider-hosted search are distinct; hosted
search is not a local function. `web_fetch` reads known public text sources. The
browser route handles missing search, confirmed pre-execution search failure, or
sources requiring rendering or interaction. Permission denial and URL blocking
never authorize a substitute route. Replacing an explicitly requested interactive
GUI operation with text-page research requires user acceptance.

# Prompt Budget And Qualification

System instructions own product behavior and boundaries; tool definitions own
purpose and non-obvious invocation semantics, including custom APIs, cursors,
identity and result shapes. Do not repeat schema constraints, field names, basic
concepts or tool tutorials. Shared time-range semantics appear once per filter.
Language, capability authority and effect recovery have one system owner. Runtime
facts need no projection tutorial; questions preserve user format and custom
input without generic writing advice. Retain complete rule reading, approval,
Stop, unknown effects, browser identity, observed GUI verification, finite-command
continuation, media references and isolated `html preview`. Do not move guidance
into tool definitions to claim system savings.

The built-in qualification surface has an 11,000-byte system budget; final live
permission-transition requests have a 12,000-byte budget including Goal injection.
The production Service fixture bounds final instructions to 10,500 bytes,
serialized definitions to 37,000 bytes, and their combined cost to 47,500 bytes.
These are deterministic regression guards, not tokenizer or total-request
measurements.
Permission/profile/allowlist tests require guidance to match supplied tools.
Definitions retain operational details; their full serialized cost is measured
as tool overhead, not credited as system savings.

`scripts/check_flower_prompt_deepseek.sh` is an opt-in paid qualification lane. It
reads the selected local DeepSeek provider and its effective `deepseek-flash`
configuration through production parsers, without modifying source state. It
requires a fresh report directory and normally repeats 24 behavior cases three
times. Model-proposed operations in those cases are not executed; synthetic
receipts allow denial, unknown-effect and GUI recovery checks without effects.
Every historical and returned call must satisfy the actual tool schema.

A separate production Service exercise performs code repair and complete rule
reading in a disposable project, waits through real terminal continuation,
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
- `redeven:internal/ai/prompt_qualification_test.go` - Size budget, schema-valid fixtures and real-provider behavior comparison.
- `redeven:internal/ai/prompt_runtime_qualification_test.go` - Isolated real execution, terminal continuation, restart, structured answer and readonly checks.
- `redeven:scripts/check_flower_prompt_deepseek.sh` - Explicit paid qualification with unchanged-source and complete-report checks.

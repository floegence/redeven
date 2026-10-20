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

One task policy, interaction policy, and failure-recovery policy govern all three
Flower profiles. Profiles express persona and user-interaction differences.
Operational guidance comes from the selected `runToolSurface`, including actual
control signals, rather than permission-mode guesses. Supplied material may be
answered directly; current file, external, and execution claims require evidence.
User and repository restrictions override generic delegation advice.
The final supplied definitions are the capability list, including Floret's Goal
tool. The host does not print a second enumeration before runtime injection.
Definitions describe capabilities; current authorization still governs each call.

Runtime context admits rule-source descriptors: absolute path, applicable
directory, and readable status. Discovery uses the authorized filesystem Registry
and checks symlinks; it does not inject rule bodies or previews. Supported names
remain `AGENTS.md`, `CLAUDE.md`, `.develop.md`, and `.introduce.md`. Before a governed
operation, Flower reads every applicable source to its end with current tools.
The manifest names the directories actually scanned and distinguishes completed
discovery with no sources from incomplete discovery. Git worktree roots bound the
ancestor path; confirmed non-repositories scan only the working directory. Missing
Git, failed root probes and invalid scope reject context admission through the
existing recoverable failure path instead of publishing an empty source list.
Another worktree or target directory requires discovery along its own repository
ancestor path. Specific directory rules override ancestor defaults; incompatible
same-scope rules use the interaction policy. Unreadable sources or missing reading
capabilities block affected operations while independent work may continue.

The complete runtime snapshot and assembled input pass published Floret public
validation before execution authority is saved. No final host-side clipping hides
sources or skill entries. Overflow rejects admission, releases the send operation
and workload lease, and permits a corrected input with the same request identity.
Earlier canonical context and provider checkpoints remain immutable. Skill
catalogs are admission facts; current capabilities alone supply activation advice.

When execution requires a user decision or the user requests guided questions,
and `ask_user` is supplied, Flower uses the structured canonical interaction.
Without that capability, the main assistant
finishes with the blocker and recovery condition; a child reports to its parent.
There is no host waiting state or duplicate question before tool approval.
Ordinary discussion and optional feedback can use prose.
The host retains Floret's question-tool description; Responses requests preserve
every supplied function description alongside its schema.

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

System instructions keep product behavior and boundaries. Tool definitions keep
purpose and non-obvious invocation semantics, without repeating general policy,
schema types, enums or basic concepts. Custom API syntax and cursor, identity,
effect and retry semantics remain explicit. Output instructions retain Redeven-specific
media references, the exact `html preview` fence and preview isolation limits.
Concise policies retain complete rule reading, user interaction, denial, Stop,
unknown-effect handling, browser identity and observed GUI verification.
The system contains no tool JSON envelopes, argument-field recipes or scripting
API examples. Short behavioral reminders keep greetings brief, preserve real
choice interaction and continue observing finite commands in the current turn.

The full built-in qualification surface has a deterministic 16,000-byte system
budget. Regression tests also enforce this budget on actual provider requests
after Floret adds Goal instructions, including live permission transitions, and
bound serialized definitions to 40,000 bytes in the same Service fixture. These
are regression guards, not tokenizer or total-request measurements.
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

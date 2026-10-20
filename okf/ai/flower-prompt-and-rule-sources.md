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

Profiles express persona and interaction differences. The selected runToolSurface,
including control signals and Floret Goal, defines capabilities. Answer directly
when context suffices. Verification or context needed to assess a request triggers
relevant workspace or authoritative external inspection. Explicit text-only
requests forbid inspection; supplied text alone does not. Workflow rules constrain
execution, never authorize extra edits, commits, pushes or deployment. Brief
consultations omit plans and progress updates.

Identify the target repository/worktree and fully read applicable AGENTS.md,
CLAUDE.md, .develop.md and .introduce.md root-to-target before dependent work.
Discovery may accompany rule reads; await contents before code inspection.
Exclude unrelated worktrees. Specific directory rules override ancestors;
user/repository restrictions override generic delegation advice. Unreadable rules
block affected work only; report blockers/conflicts.

Manifests list rule paths/scope/readability, not contents. Discovery checks
symlinks, distinguishes empty scans from failures and stops at Git roots.
New worktrees require discovery. Floret validates complete admitted context;
overflow releases admission for corrected same-identity retry. Earlier context
remains immutable. Skill catalogs are facts, not activation instructions.

Use ask_user for necessary decisions and requested guided questions; ordinary
discussion/optional feedback may use prose. Noninteractive runs report blockers.
Tool calls submit approval; never duplicate approval with a question. Floret owns
schema correction, approval, cancellation, restart and [Goal](flower-goals.md).
Observe finite commands this turn with existing process identity/returned cursor.
Timeout classification retains partial results: hints do not prove non-execution
or authorize replay. Inspect uncertainty; never bypass denials. No default Todo.

Filesystem roots/permissions define access; paths/references grant no authority.
Authorized sibling worktrees use explicit terminal cwd/workdir and absolute file
paths. apply_patch stays in the run directory; elsewhere use file tools.
read_file retains typed pagination. Cite verified research URLs; local/hosted
search differ. Browser fallback serves unavailable search, confirmed pre-execution
failure or rendering needs, never denial. Replacing requested GUI work requires
user acceptance.

# Prompt Budget And Qualification

Policies own behavior; definitions own schemas/APIs/cursors. Do not shift guidance
into tool definitions to claim savings. Preserve approval, Stop, uncertain effects,
browser identity, verification, finite commands, media and isolated HTML previews.

Byte budgets are deterministic guards, not tokenizer measurements: 11,000 for the
built-in surface, 12,000 for permission transitions including Goal, and 9,839 for
the production fixture (definitions 37,000; combined 47,500). All 18 permission/
profile/allowlist combinations shrink 50 UTF-8 bytes against `b65d82480`, retaining
definition hashes. The final Goal-injected fixture falls from 9,889 to 9,839
bytes; definitions remain 36,683 bytes. Replaced instructions use 1,948 bytes
versus 1,998. Personas, Goal guidance and tool contracts are unchanged.

`scripts/check_flower_prompt_deepseek.sh` is an opt-in paid lane. It uses the
selected local DeepSeek provider's effective `deepseek-flash` configuration via
production parsers, fresh reports and normally three repetitions of 33 cases.
Synthetic receipts test denial and uncertain effects without executing proposed
operations. Fixtures and returned calls must satisfy tool schemas.

Acceptance tests intent, evidence, scope and effects. Text-only requests forbid
inspection; repository-aware assessment requires source evidence. Open-ended rule
assessment permits proportionate read-only inspection. Quoted workflows do not
authorize delivery. Calls/provider steps are efficiency observations; one-step
routing cannot establish eventual completion of independent work after a blocker.

Service retains Goal and real tools. A disposable Git repository carries a hidden
workflow fact; the answer must use actual receipts, accepting equivalent Chinese.
File snapshots and arguments check effects. Complete rules precede dependent reads;
specifications precede repair. Process identity/cursors/completion, restart,
structured input resume and readonly execution remain covered.

Conservative shell classification does not prove a write. Unknown syntax/relevance
is review_required, neither pass nor fail; scripts stay nonzero pending review.
Oracle regressions cover incomplete/paginated rules, failed receipts, unsupported
facts, unauthorized writes, process relaunches and wrong cursors. Manual semantic
review must also assess source meaning and answer usefulness, not just keywords.

Freeze prompts, inputs and harness before sampling. Retain hashes, requests,
receipts, responses, errors and usage, never credentials. Missing configuration,
skips or absent reports do not qualify. After oracle repairs, the same scorer in
TestFlowerPromptQualificationRetainedEvidence reassesses both immutable response
sets offline into a separate report; it does not resample until green or erase
provider errors. Baseline source overlays cover old-prompt Service execution.
Remove copied credentials/overlays before formal checks. Measure system bytes
separately from provider input, including cache-read tokens.

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

Redeven owns product prompts and tool adaptation. The published Floret runtime owns
canonical interaction, approval, cancellation, context validation and recovery.
This change adds no public API, tool input shape, storage schema, durable rule
loader, provider checkpoint rewrite or parallel waiting lifecycle.

# Evidence

- redeven:internal/ai/prompt_builder.go — Shared policies; prompt_profiles.go owns unchanged personas.
- redeven:internal/ai/prompt_workspace_context.go — Authorized manifests and complete runtime context.
- redeven:internal/ai/send_user_turn.go — Admission before persistence.
- redeven:internal/ai/prompt_consistency_test.go — Surface and byte/hash matrix.
- redeven:internal/ai/prompt_rule_sources_test.go — Complete reads and bounded discovery.
- redeven:internal/ai/prompt_context_admission_test.go — Overflow and same-identity retry.
- redeven:internal/ai/floret_ask_user_integration_test.go — Natural completion and follow-up.
- redeven:internal/ai/thread_permission_admission_test.go — Live permission surfaces.
- redeven:internal/ai/tools/orchestrator_test.go — Conservative retry advice.
- redeven:internal/ai/tool_timeout_test.go — Actual timeout/partial-result dispatch.
- redeven:internal/ai/prompt_qualification_test.go — Provider sampling and retained scoring.
- redeven:internal/ai/prompt_runtime_qualification_test.go — Real isolated execution.
- redeven:scripts/check_flower_prompt_deepseek.sh — Paid lane and pending-review summary.

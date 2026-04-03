# Flower Behavioral Eval Workflow

This document describes the current Flower evaluation workflow in Redeven.

The workflow is gate-first:

1. replay known bad trajectories
2. run a behavioral task suite against the live Flower runtime
3. compare suite metrics against configured baselines
4. block promotion when the hard gate fails

## Entry points

Behavioral suite:

```bash
./scripts/eval_ai_loop_matrix.sh /abs/path/to/target-repo
```

Local-config sandbox suite:

```bash
./scripts/eval_local_config_sandbox_suite.sh /abs/path/to/target-repo
```

Hard-gate suite:

```bash
./scripts/eval_gate.sh /abs/path/to/target-repo
```

`eval_ai_loop_matrix.sh` keeps its historical name for compatibility, but it now runs the single behavioral suite rather than a prompt/loop profile matrix.

`eval_local_config_sandbox_suite.sh` is the dedicated entry point for validating the locally active Flower model configuration. It does not force a provider or model on the command line; instead it uses the current `ai.current_model_id` from local config, so if your current local setup is `moonshot/kimi-k2.5`, the suite runs on that model automatically. The wrapper also disables benchmark baselines by default unless you explicitly provide `BASELINE_PATH`, because this suite is meant for provider-specific local diagnostics rather than the shared open-source promotion gate.

The local-config sandbox suite is also the main end-to-end regression surface for the structured runtime protocol. It intentionally exercises:

- `file.read` for direct repository inspection
- `exit_plan_mode` for readonly plan-to-act escalation
- `write_todos` for multi-step readonly discipline
- `file.write` and `file.edit` for deterministic structured mutations
- `apply_patch` as a compatibility editing path
- workspace-boundary refusal when a task asks for an out-of-scope write

For structured edit and compatibility tasks, verification should be command-backed: the intended success path is mutation via `file.*` or `apply_patch`, then verification via `terminal.exec`, then a user-facing summary with evidence paths.

## Inputs

Environment variables:

- `TASK_SPEC_PATH`
- `BASELINE_PATH`
- `ENFORCE_GATE`

CLI flags from `cmd/ai-loop-eval`:

- `--task-spec`
- `--baseline`
- `--enforce-gate`
- `--min-pass-rate`
- `--min-loop-safety-rate`
- `--min-fallback-free-rate`
- `--min-accuracy`

## Behavioral suite model

The suite is task-centric, not profile-centric.

Each task runs against the real Flower runtime with:

- a real thread execution mode (`act` or `plan`)
- real run knobs (`max_steps`, `max_no_tool_rounds`, `reasoning_only`, `no_user_interaction`, `require_user_confirm_on_task_complete`)
- real runtime policy decisions, including `intent` and `execution_contract`
- real tools and real persisted runtime state

Each task gets its own isolated workspace copy under the report directory, and the eval runner now also gives each task its own runtime state directory with that cloned workspace as the runtime home. This protects the source repo and keeps tool path scope pinned to the isolated copy while still allowing Flower to run with normal RWX permissions and real tool semantics.

## Task spec schema

Tasks are loaded from YAML under `eval/tasks/` and support:

- `stage`
- `category`
- `turns`
- `runtime`
- `assertions.output`
- `assertions.thread`
- `assertions.tools`
- `assertions.events`
- `assertions.todos`

Tool assertions also support `workspace_scoped_tools`, which fails a task when those tool calls contain path arguments that escape the isolated task workspace. Structured file tools (`file.read`, `file.edit`, `file.write`) participate in the same boundary checks as `apply_patch` and `terminal.exec`.

Assertion groups are intentionally structural:

- output: evidence, minimum path count, minimum length, required phrases, forbidden phrases
- thread: final `run_status`, final `execution_mode`, waiting prompt presence
- tools: required tool calls, forbidden tool calls, success requirements, call budget, and workspace-scope safety
- events: required event types, forbidden event types, hard-fail event types
- todos: snapshot presence, non-empty plan, closed plan, in-progress discipline

Runtime-owned signal tools such as `ask_user` and `exit_plan_mode` are expected to appear as normal successful tool-call records in reports so eval assertions can treat them the same way as scheduler-dispatched tools.

Runtime-output invariants worth asserting explicitly:

- a single assistant run should converge to one canonical visible answer, not multiple concatenated final-answer revisions
- draft text from a still-active run must not be replayed into later provider turns as committed assistant history
- `execution_contract` should explain why a run ended directly, promoted into an agentic loop, or persisted into `waiting_user`
- `protocol_closeout` may recover only clean in-band completion; interrupted or canceled runs must never be reported as successful closeout

## Report model

The report is suite-oriented:

- per-task results include output preview, thread state, tool summary, todo snapshot, event counts, evidence paths, and hard-fail reasons
- suite metrics aggregate pass rate, loop safety, recovery success, fallback-free rate, and average scores
- stage metrics aggregate the same metrics for `screen` and `deep`

Artifacts:

- `report.json`
- `report.md`
- `state/`
- `workspaces/`

Default output directory:

- `~/.redeven/ai/evals/<timestamp>/`

The local-config sandbox suite writes the same report shape and is intended for provider-specific smoke/regression runs such as "verify my current Kimi setup can inspect with file.read, escalate with exit_plan_mode, write safely inside the sandbox, preserve apply_patch compatibility, and refuse outside-workspace edits."

## Hard gate

The hard gate compares the suite against:

1. absolute thresholds
2. best metrics across configured baseline sources

Metrics:

- `pass_rate`
- `loop_safety_rate`
- `recovery_success_rate`
- `fallback_free_rate`
- `average_accuracy`

Gate output is written into `report.json` under `gate`.

## Replay validation

`cmd/ai-loop-replay` replays persisted transcripts and rejects known anti-patterns such as:

- fallback final text
- tool-heavy runs without a concrete conclusion
- empty assistant output after structured Flower tool completion

Replay now treats `ask_user` and `task_complete` blocks as valid assistant-visible output when no markdown/text block exists.

Fixtures live in:

- `eval/replay_cases/loop_exhausted_fail.message.log.json`
- `eval/replay_cases/normal_pass.message.log.json`

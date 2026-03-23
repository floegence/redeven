# Flower Behavioral Eval Workflow

This document describes the current Flower evaluation workflow in Redeven Agent.

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

Hard-gate suite:

```bash
./scripts/eval_gate.sh /abs/path/to/target-repo
```

`eval_ai_loop_matrix.sh` keeps its historical name for compatibility, but it now runs the single behavioral suite rather than a prompt/loop profile matrix.

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
- real tools and real persisted runtime state

Each task gets its own isolated workspace copy under the report directory. This protects the source repo while still allowing Flower to run with normal RWX permissions and real tool semantics.

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

Assertion groups are intentionally structural:

- output: evidence, minimum path count, minimum length, required phrases, forbidden phrases
- thread: final `run_status`, final `execution_mode`, waiting prompt presence
- tools: required tool calls, forbidden tool calls, success requirements, call budget
- events: required event types, forbidden event types, hard-fail event types
- todos: snapshot presence, non-empty plan, closed plan, in-progress discipline

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

# Flower (Optional)

Redeven can optionally enable **Flower**, an on-device AI assistant inside the Env App UI.

High-level design:

- The browser UI calls the runtime via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go runtime is the security boundary** and executes tools after validating authoritative session metadata.
- Tooling now uses a structured file-operation surface by default: `file.read` for direct inspection, `file.edit` / `file.write` for deterministic mutations, `terminal.exec` for investigation and verification, and `apply_patch` as a compatibility fallback.
- LLM orchestration runs in the **Go runtime** via native provider SDK adapters:
  - OpenAI: `openai-go` (Responses API)
  - Moonshot: `openai-go` (Chat Completions API on Moonshot base URL)
  - Anthropic: `anthropic-sdk-go` (Messages API)
- OpenAI Responses continuation is treated as an optimization layer rather than a second context system: Flower resumes with `previous_response_id` only when the same thread stays on a compatible OpenAI provider/model/base URL fingerprint, and otherwise falls back to the canonical local `PromptPack` replay path.

## Prompt architecture

Flower task prompts are built through a section-oriented runtime prompt builder rather than one monolithic string assembly path.

- The prompt is split into:
  - a cacheable static prefix for durable operating policy;
  - a dynamic runtime tail for execution/completion contracts, runtime context, workspace context, interaction contract, and skills;
  - overlay sections for recovery or exception guidance.
- Static prefix caching is intentionally conservative and excludes volatile facts such as the current objective text, round counters, local date/timezone context, git/worktree state, repository rule excerpts, delegation state, todo counts, recent errors, skill overlays, and exception overlays.
- Runtime context includes authoritative local date and timezone facts sampled from the runtime host when the prompt is built, so relative date references can be grounded without adding scenario-specific heuristics.
- Workspace context is collected at prompt-build time and exposes:
  - environment facts such as shell, runtime home, approval policy, dangerous-command blocking, web-search provider, and whether subagent delegation is available;
  - repository state such as git repository detection, worktree root, branch/upstream, ahead-behind, linked-worktree status, and a staged/unstaged/untracked summary;
  - durable repository rule files discovered from the current worktree path (for example `AGENTS.md`, `CLAUDE.md`, `.introduce.md`, and legacy `.develop.md`) under an explicit prompt budget;
  - active subagent/delegation state so the parent agent can see ongoing parallel work instead of redoing it.
- Runtime gates remain authoritative for `ask_user` and `task_complete`; prompt structure guides model behavior but does not replace deterministic runtime validation.
- `prompt_profile` is a real behavior switch, not metadata only:
  - `main_interactive`: the normal top-level Flower run that may ask the user for structured input when capability allows it;
  - `main_autonomous`: a top-level Flower run with user interaction disabled that still writes as the main assistant for the user-facing thread;
  - `subagent_autonomous`: a delegated child run that must stay parent-facing, must not pretend to address the end user directly, and should report verified findings, blockers, and suggested parent actions.

## Requirements

- Runtime path does **not** require Node.js.
- Provider API keys are stored locally in a separate secrets file (never store secrets in `config.json`).

## Configuration

Enable Flower by adding an `ai` section to the runtime config file (default machine state: `~/.redeven/machine/config.json`).

Notes:

- Providers own their model list: `ai.providers[].models[]` is the allow-list shown in the Chat UI.
- `ai.current_model_id` points to the default model for new chats.
- The wire model id remains `<provider_id>/<model_name>` and each thread stores its own `model_id`.
- Changing the model on an existing thread is thread-scoped only; it does not rewrite `ai.current_model_id`.
- `providers[].base_url` is optional for `openai` / `anthropic`, and **required** for `moonshot` / `chatglm` / `deepseek` / `qwen` / `openai_compatible`.

API keys:

- Keys are stored in the machine state's `secrets.json` (for example `~/.redeven/machine/secrets.json`, chmod `0600`) and never returned in plaintext.
- You can configure keys from the Env App UI: Runtime Settings -> `AI & Extensions` -> Flower -> Provider -> API key.
- Multiple provider keys can be stored at the same time (keyed by `providers[].id`).
- At runtime, Go resolves the provider key from local secrets per run and injects it directly into the provider SDK client.

Example:

```json
{
  "controlplane_base_url": "https://<redeven-environment-host>",
  "environment_id": "env_xxx",
  "agent_instance_id": "ai_xxx",
  "direct": {
    "ws_url": "wss://...",
    "channel_id": "ch_..."
  },
  "permission_policy": {
    "schema_version": 1,
    "local_max": { "read": true, "write": true, "execute": true }
  },
  "ai": {
    "execution_policy": {
      "require_user_approval": false,
      "block_dangerous_commands": false
    },
    "current_model_id": "openai/gpt-5.5",
    "providers": [
      {
        "id": "openai",
        "type": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": [
          { "model_name": "gpt-5.5", "context_window": 1050000, "max_output_tokens": 128000 },
          { "model_name": "gpt-5.4-mini", "context_window": 400000, "max_output_tokens": 128000 }
        ]
      },
      {
        "id": "anthropic",
        "type": "anthropic",
        "name": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "models": [
          { "model_name": "claude-opus-4-7", "context_window": 1000000, "max_output_tokens": 128000 },
          { "model_name": "claude-sonnet-4-6", "context_window": 1000000, "max_output_tokens": 64000 },
          { "model_name": "claude-haiku-4-5-20251001", "context_window": 200000, "max_output_tokens": 64000 }
        ]
      }
    ]
  }
}
```

## Tooling and execution policy

Built-in tools:

- `file.read`
- `file.edit`
- `file.write`
- `terminal.exec`
- `apply_patch`
- `write_todos`
- `exit_plan_mode`
- `web.search` (optional; controlled by `ai.web_search_provider`)

Structured file-tool notes:

- `file.read` is the primary file inspection path for code and text files.
- `file.edit` performs exact string replacement with deterministic single-match or replace-all semantics.
- `file.write` creates or replaces a full file deterministically inside the active project root.
- Structured file tools resolve relative paths from the thread working directory, and runtime path validation requires the final path to stay inside both the runtime-home sandbox and the active project root.
- When a task explicitly asks for verification or a verification command, Flower should use `terminal.exec` for that verification step; `file.read` can supplement inspection, but it does not replace a real verification command.

Patch execution notes:

- The model-facing `apply_patch` contract is a single canonical format: one document from `*** Begin Patch` to `*** End Patch` with relative paths plus `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks.
- `apply_patch` remains supported during migration, but it is a compatibility path rather than the primary edit surface for new runs.
- `diff --git` unified diff parsing remains available as a compatibility path for older payloads, but it is not the recommended format for normal Flower-authored edits.
- Hunk matching is intentionally controlled and explainable: Flower tries exact line matching first, then trailing-whitespace-tolerant matching, then Unicode punctuation normalization.
- If `apply_patch` fails for a normal file edit, Flower should re-read the file and regenerate a fresh canonical patch instead of switching to shell overwrite/redirection commands.

Terminal execution notes:

- `terminal.exec` command classification is effect-oriented: common local inspection commands (for example file metadata probes and archive-to-stdout inspection flows) stay readonly, while explicit writes / uploads / extraction-to-disk remain mutating.
- `terminal.exec` uses a bounded execution policy by default: when `timeout_ms` is omitted, Flower applies a 2-minute default timeout; any requested timeout is capped at 10 minutes.
- `terminal.exec` timeout decisions are explicit and observable: the persisted terminal result records the effective timeout plus whether it came from the default policy, an explicit request, or a capped request.
- `terminal.exec` timeout/cancel handling now terminates the full shell process tree/group rather than only the direct shell process.
- Flower does not create new checkpoints during normal runs. Legacy checkpoint rows and `workspace_json` artifacts are retained only for backward-compatible cleanup and best-effort restore handling of pre-existing data.

Online research notes:

- Prefer direct requests to authoritative sources via `terminal.exec` + `curl` when you already know the right URL.
- Use `web.search` (or provider built-in web search) only for discovery; always open and validate the underlying pages before relying on them.

Hard guardrails are controlled by `ai.execution_policy`:

- `require_user_approval`: when true, mutating tool calls require explicit user approval.
- `block_dangerous_commands`: when true, dangerous `terminal.exec` commands are hard-blocked.

Default values are intentionally permissive:

- `require_user_approval = false`
- `block_dangerous_commands = false`

Behavior summary:

- `act` mode executes tools directly by default.
- `plan` mode is strict readonly: mutating tool calls are blocked.
- In `plan`, readonly `terminal.exec` commands are still allowed, including readonly HTTP fetches that only stream to stdout (for example `curl -s URL`, `curl -I URL`, `wget -qO- URL`).
- In `plan`, HTTP commands that write local files/state or send request bodies/uploads are mutating and blocked (for example `curl -o`, `curl -d`, `curl -F`, `curl -T`, `wget -O file`, `wget --post-data`).
- Execution mode is a thread-level server state (`execution_mode`) and is authoritative for every run.
- If execution is needed in `plan`, Flower should use `exit_plan_mode` to request switching the thread to `act`.
- `exit_plan_mode` is converted runtime-side into the existing waiting-user prompt UI with deterministic `set_mode` actions; the model no longer needs to handcraft a manual mode-switch `ask_user` payload.
- Runtime-owned signal tools such as `ask_user` and `exit_plan_mode` are still persisted as successful tool-call records so evals, audits, and transcript recovery can observe them consistently.
- Every `ask_user` question should use the canonical question-level response contract. Each question declares `response_mode`, `choices[]` contains fixed options only, and any choice-based question must also declare `choices_exhaustive`.
- `ask_user` is the canonical structured-input primitive both for true blockers and for guided structured interaction turns such as questionnaires, interviews, quizzes, guessing games, decision trees, and other option-driven conversations.
- Guided structured interactions should be front-loaded into an explicit interaction contract classified with the run policy, then preserved consistently across prompts, gates, waiting-user rendering, and completion.
- Run policy is split into `intent` and `execution_contract`:
  - `intent` describes user-facing semantics (`social`, `creative`, `task`).
  - `execution_contract` describes runtime shape (`direct_reply`, `hybrid_first_turn`, `agentic_loop`).
- `task` intent no longer implies explicit-completion by itself. Flower may start a task run in `hybrid_first_turn`, answer directly in the first turn when the request is fully resolved, and only promote into `agentic_loop` when durable multi-step execution is actually needed.
- Implicit reply completion is provider-finish-aware, not text-presence-only. A reply may auto-complete only after a clean terminal provider outcome; truncation must continue/recover, and blocked provider finishes such as `content_filter` must fail visibly instead of being relabeled as a successful answer.
- When a validated structured prompt response continues an existing guided objective, Flower should reuse that continuation context deterministically instead of spending extra classifier turns to rediscover `task + continue`.
- Persisted waiting-prompt interaction contracts are the durable source of truth for those guided continuations; the runtime should reuse them directly and mark observability payloads explicitly when seed reuse is taken.
- The run-policy classifier should prefer a single synthetic tool call with an explicit schema, including `interaction_contract`, and only fall back to text JSON parsing when tool calls are unavailable, so reasoning-heavy providers do not leak prose into classifier payloads.
- Flower should preserve explicit interaction-shape constraints from the user, such as fixed options, clickable choices, one-question-at-a-time, or indirect questioning.
- When the active interaction contract requires fixed choices plus an open fallback, Flower should keep `response_mode:"select_or_write"` with `choices_exhaustive:false` instead of regressing to exhaustive `select` or pure `write`.
- When the active interaction contract requires indirect questioning, Flower should not directly name, bucket, or reveal the hidden target attribute in either the question text or the fixed choices.
- For guided questionnaires, quizzes, guessing games, or hidden-target inference about the user's real-world state, Flower should usually narrow the next turn with fixed choices plus a typed fallback rather than a pure write-only question.
- Use `response_mode:"select"` only when fixed choices are genuinely exhaustive by construction and `choices_exhaustive:true`.
- Use `response_mode:"select_or_write"` when fixed choices are not exhaustive and `choices_exhaustive:false`, so the UI preserves a standardized typed fallback such as `None of the above: ___`.
- Use `response_mode:"write"` for direct-input questions with no fixed choices.
- If the user explicitly asks for answer choices or clickable options, Flower should not silently downgrade the turn into a pure `response_mode:"write"` question.
- When Flower offers fixed options about a user's real-world state, preferences, habits, background, or other non-exhaustive situations, it should treat the set as non-exhaustive by default and use `response_mode:"select_or_write"` with `choices_exhaustive:false` instead of pretending the list is exhaustive.
- Use `write_label` and optional `write_placeholder` to control the standardized typed fallback wording when `response_mode:"select_or_write"` is used.
- A `response_mode:"write"` or `response_mode:"select_or_write"` path is incomplete until the user provides its text payload.
- If a turn is going to end in `waiting_user` via `ask_user`, Flower should put the user-facing question inside the structured `ask_user` payload rather than first emitting a duplicated standalone markdown questionnaire or option list.
- Intent routing should classify guided structured interactions that need `ask_user` as `task`, not `social`; `social` is reserved for casual freeform chat without structured interaction needs.
- In no-user-interaction runs, Flower cannot ask for a mode switch and must finish through `task_complete`.
- Top-level no-user-interaction runs should stay user-facing (`main_autonomous`), while delegated child runs should stay parent-facing (`subagent_autonomous`).
- The Env App shows approval prompts only when `require_user_approval` is enabled.
- `write_todos` is expected for multi-step tasks; exactly one todo should stay in `in_progress`.
- `task_complete` is rejected when todo tracking is active and open todos still exist.
- Structured protocol runs may also finish through runtime-assisted closeout after verified tool work plus a strong final answer, even if the model forgot to emit `task_complete`; this keeps compatibility with weaker tool-using models without removing explicit completion support.
- Runtime-assisted closeout is only a clean in-band completion recovery path. Interrupted, canceled, or timed-out runs must keep their interruption outcome even if partial final text and verified tool work already exist.
- Flower keeps exactly one canonical visible answer slot per assistant run. Later answer revisions replace the current candidate instead of being appended as additional final-answer turns.
- In the Env App UI, that canonical answer slot is rendered through two coordinated surfaces: settled transcript rows for persisted history, and a dedicated live assistant tail for the current in-flight answer. The runtime must never let both surfaces show the same assistant message at once.
- Draft text produced inside the same run must stay separate from assistant history. Flower may stream draft markdown to the active answer block, but it must not feed that draft back into the next provider turn as if it were a committed assistant transcript message.
- When a run completes through `task_complete`, its `task_complete.result` is the canonical final assistant completion text. Persisted assistant transcript snapshots must keep that canonical completion text aligned with the single user-visible markdown answer even if the run streamed mixed `thinking`, `tool-call`, and `markdown` blocks before completion.
- `ask_user` follows a structured contract (`questions`, `reason_code`, `required_from_user`, `evidence_refs`) and is deterministically validated before entering `waiting_user`; runtime enforcement is limited to capability, schema, evidence, todo, and interaction-contract consistency checks rather than a second semantic policy classifier.
- When a run completes into `waiting_user` through `ask_user`, the final assistant transcript must canonically converge to the structured waiting interaction instead of keeping provisional text-only markdown from earlier no-tool turns.
- Structured prompt answers are submitted through a dedicated prompt-response action rather than the plain chat `sendMessage` path.
- The Env App may auto-submit a waiting prompt only for the narrow single-question, non-secret, pure-choice case with no extra detail requirement or option action; every richer interaction still uses explicit structured submission.
- When a thread is still `waiting_user`, the waiting prompt snapshot in `ai_threads.waiting_user_input_json` should stay aligned with the assistant transcript `ask_user` block; read/write paths recover from the latest persisted assistant transcript when that snapshot is missing or invalid.
- The Env App must distinguish a resolved prompt from a still-waiting thread whose active prompt details are temporarily unavailable; missing prompt state must not be rendered as already handled.
- Thread `title` and `last_message_preview` serve different purposes: `title` is a durable conversation label, while `last_message_preview` is the latest sidebar snippet.
- Thread runtime metadata also carries `last_context_run_id`, which identifies the latest run whose persisted context telemetry should be recoverable after the live run has already ended.
- Empty thread titles stay empty until a dedicated auto-title generator summarizes public user intent; persisting the raw first user message as `title` is not allowed.
- Auto titles are generated from public user-visible text only, recorded with title metadata (`title_source`, input message id, model id, prompt version), and may only fill a still-untitled thread.
- Auto-title generation is a single-purpose background flow with bounded retry backoff. Inside one generation pass, the runtime may retry once with a larger output budget when a reasoning-heavy model exhausts the first budget before emitting visible JSON title text; if three generation passes still fail, the runtime should stop provider retries, fall back to a truncated first user message as a temporary title, and allow a later user message in that thread to trigger a fresh auto-title attempt.
- Service startup performs a recovery scan for recent still-untitled threads and re-enqueues title generation from the latest persisted public user message, so a runtime restart does not strand blank titles.
- Manual rename always wins. Once a thread is manually renamed, later automatic generation must not overwrite that user-owned title state, even if the user intentionally renamed it to blank.
- no-tool backpressure defaults to 3 rounds, but active guided structured continuations may jump directly into a signal-only recovery turn (`ask_user` / `task_complete`) once the threshold is hit so Flower does not waste another generic text-only round.
- Runtime observability for these fast paths should stay explicit through `interaction.contract.classified.classification_mode`, `ask_user.attempt.validation_mode`, and `signal.recovery.attempt`.
- `terminal.exec` output is rendered with structured shell blocks in the Env App (no markdown fallback conversion).
- Live assistant `block-delta` transport must preserve complete user-visible markdown/reasoning content. Provider adapters must keep provider-emitted visible whitespace semantics intact for streamed reasoning fragments so persisted transcripts and live blocks stay human-readable.
- Active-run snapshots are a recovery path for the in-flight assistant turn, not a second transcript source. Once the assistant message has been appended to persisted transcript history, snapshot reads must return empty for that turn so the UI cannot render duplicate assistant answers from both transcript and live state.
- The live assistant surface is intentionally outside transcript virtualization so streaming markdown growth, phase-label changes, and context telemetry ornament updates do not thrash transcript row measurement or remount settled history during a run.
- The realtime sink may coalesce low-priority assistant/context updates, but the active thread UI must still converge to the canonical persisted assistant transcript when the run reaches a terminal state, even if some tail realtime frames were missed.
- Subagents are for parallelizable or independently reviewable work. Simple local inspection tasks should stay in the main Flower run instead of spawning subagents.
- Flower thread read/unread state is runtime-authoritative, not browser-local:
  - the gateway persists a per-user watermark keyed by `endpoint_id + user_public_id + surface + thread_id`;
  - thread list/detail payloads include `read_status` with `{is_unread, snapshot, read_state}`;
  - `POST /_redeven_proxy/api/ai/threads/:id/read` advances the user's read watermark monotonically from the browser-visible snapshot;
  - the gateway validates that submitted read snapshots do not move beyond the current backend thread state;
  - when a user has no stored watermark yet, the runtime seeds the current snapshot as the initial baseline so historical threads do not all light up as unread after rollout.

Installer note:

- `scripts/install.sh` installs pinned ripgrep binaries into `~/.redeven/tools/rg/<version>/<platform>/rg` and links `~/.redeven/bin/rg`, so shell-first search is available even when the system does not provide `rg`.

## Threadstore Persistence Contract

- Flower thread persistence is thread-scoped by default. Deleting a thread removes its transcript rows, queued followups, run records, tool-call records, run events, checkpoints, structured waiting-input rows, todos, thread state, and derived context planes.
- Upload blobs are persisted as first-class threadstore resources (`ai_uploads`) with explicit message/followup references (`ai_upload_refs`) instead of relying on transcript JSON scraping as the steady-state ownership source.
- Fresh uploads start as staged runtime-local blobs. Once a message or queued followup claims them, they become thread-owned resources; deleting that thread or deleting an unconsumed followup removes the corresponding refs, deletes any newly unreferenced upload blobs/metadata, and then runs best-effort SQLite compaction so on-disk usage converges after cleanup.
- Checkpoint restore follows the same ownership boundary: thread-scoped run/tool/event artifacts that were created after the checkpoint are pruned during restore instead of being left behind as residual history.
- The `workspace_json` column is now a legacy compatibility payload only. New checkpoints are thread-state-only; old workspace checkpoint artifacts are cleaned up best-effort during retention pruning, thread deletion, and startup orphan sweeps.
- OpenAI Responses continuation state is persisted in `ai_thread_state` together with other thread-scoped runtime metadata. Flower updates that state only after the assistant transcript has been durably appended, clears it when a run reaches terminal task completion or when no fresh continuation survives the run, and invalidates it before retrying a local replay turn if the provider rejects `previous_response_id`.
- `provider_capabilities` is intentionally a global cache keyed by provider/model and is not deleted with any single thread.
- The current shipped schema keeps semantic memory in `memory_items`. Redeven does not currently ship a separate persistent embeddings table until the runtime fully owns that lifecycle.
- Per-user thread read watermarks are intentionally stored outside the shared Flower threadstore because unread state is a user/session concern rather than collaborative thread content.
- Deleting a Flower thread also clears its companion Flower read-watermark rows from the separate read-state store. The gateway snapshots those rows first and restores them if the primary thread delete fails, so successful deletes do not leave stale unread metadata behind.

## Behavioral evaluation

Flower quality is validated with a behavioral eval harness, not just transcript keyword checks.

The eval harness runs real Flower tasks and asserts:

- final thread state (`run_status`, `execution_mode`, waiting prompt behavior)
- structural tool behavior (`file.read`, `file.edit`, `file.write`, `terminal.exec`, `write_todos`, `exit_plan_mode`, `task_complete`, forbidden tools)
- runtime events such as `ask_user.waiting`, `todos.updated`, and loop-failure signals
- structured workspace-scope enforcement for `file.read`, `file.edit`, `file.write`, `apply_patch`, and `terminal.exec`
- todo discipline, including final closeout and single `in_progress` execution
- assistant-visible output, evidence paths, and fallback-free closeout

Each eval task now declares a workspace mode instead of always cloning the full repository:

- readonly repository tasks can run directly against the real source workspace with readonly exec enforcement
- protocol-only tasks can use an empty task workspace
- mutation tasks can use a tiny writable fixture workspace without touching the source repository under test

See also:
- `PERMISSION_POLICY.md` for how the local RWX cap works (and what it does not cap).
- `CAPABILITY_PERMISSIONS.md` for the complete capability-to-permission mapping.

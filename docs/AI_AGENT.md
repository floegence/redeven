# Flower (Optional)

Redeven Agent can optionally enable **Flower**, an on-device AI assistant inside the Env App UI.

High-level design:

- The browser UI calls the agent via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go agent is the security boundary** and executes tools after validating authoritative session metadata.
- Tooling follows a shell-first workflow: `terminal.exec` for investigation and verification, `apply_patch` for file edits.
- LLM orchestration runs in the **Go runtime** via native provider SDK adapters:
  - OpenAI: `openai-go` (Responses API)
  - Moonshot: `openai-go` (Chat Completions API on Moonshot base URL)
  - Anthropic: `anthropic-sdk-go` (Messages API)

## Requirements

- Runtime path does **not** require Node.js.
- Provider API keys are stored locally in a separate secrets file (never store secrets in `config.json`).

## Configuration

Enable Flower by adding an `ai` section to the agent config file (default: `~/.redeven/config.json`).

Notes:

- Providers own their model list: `ai.providers[].models[]` is the allow-list shown in the Chat UI.
- `ai.current_model_id` points to the default model for new chats.
- The wire model id remains `<provider_id>/<model_name>` and each thread stores its own `model_id`.
- Changing the model on an existing thread is thread-scoped only; it does not rewrite `ai.current_model_id`.
- `providers[].base_url` is optional for `openai` / `anthropic`, and **required** for `moonshot` / `chatglm` / `deepseek` / `qwen` / `openai_compatible`.

API keys:

- Keys are stored in `~/.redeven/secrets.json` (chmod `0600`) and never returned in plaintext.
- You can configure keys from the Env App UI: Agent Settings → Flower → Provider → API key.
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
    "current_model_id": "openai/gpt-5-mini",
    "providers": [
      {
        "id": "openai",
        "type": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": [
          { "model_name": "gpt-5-mini" },
          { "model_name": "gpt-5" }
        ]
      },
      {
        "id": "anthropic",
        "type": "anthropic",
        "name": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "models": [
          { "model_name": "claude-3-5-sonnet-latest" }
        ]
      }
    ]
  }
}
```

## Tooling and execution policy

Built-in tools:

- `terminal.exec`
- `apply_patch`
- `write_todos`
- `web.search` (optional; controlled by `ai.web_search_provider`)

Terminal execution notes:

- `terminal.exec` command classification is effect-oriented: common local inspection commands (for example file metadata probes and archive-to-stdout inspection flows) stay readonly, while explicit writes / uploads / extraction-to-disk remain mutating.
- Mutating workspace actions create a pre-run workspace checkpoint. Tar-based checkpoints now skip unreadable paths and record the skipped entries in checkpoint metadata instead of failing the whole run on unrelated permission-denied filesystem branches.

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
- If edits are needed in `plan`, Flower should use `ask_user` to request switching the thread to `act`.
- The mode-switch `ask_user` must use structured `questions[]`, and deterministic UI actions belong on `questions[].choices[].actions` (for example `[{type:"set_mode",mode:"act"}]`).
- Every `ask_user` question should use the canonical question-level response contract. Each question declares `response_mode`, `choices[]` contains fixed options only, and any choice-based question must also declare `choices_exhaustive`.
- `ask_user` is the canonical structured-input primitive both for true blockers and for guided structured interaction turns such as questionnaires, interviews, quizzes, guessing games, decision trees, and other option-driven conversations.
- Guided structured interactions should be front-loaded into an explicit interaction contract classified with the run policy, then preserved consistently across prompts, gates, waiting-user rendering, and completion.
- Run policy is split into `intent` and `execution_contract`:
  - `intent` describes user-facing semantics (`social`, `creative`, `task`).
  - `execution_contract` describes runtime shape (`direct_reply`, `hybrid_first_turn`, `agentic_loop`).
- `task` intent no longer implies explicit-completion by itself. Flower may start a task run in `hybrid_first_turn`, answer directly in the first turn when the request is fully resolved, and only promote into `agentic_loop` when durable multi-step execution is actually needed.
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
- In no-user-interaction runs, Flower cannot ask for a mode switch and must finish with blockers in `task_complete`.
- The Env App shows approval prompts only when `require_user_approval` is enabled.
- `write_todos` is expected for multi-step tasks; exactly one todo should stay in `in_progress`.
- `task_complete` is rejected when todo tracking is active and open todos still exist.
- Flower keeps exactly one canonical visible answer slot per assistant run. Later answer revisions replace the current candidate instead of being appended as additional final-answer turns.
- Draft text produced inside the same run must stay separate from assistant history. Flower may stream draft markdown to the active answer block, but it must not feed that draft back into the next provider turn as if it were a committed assistant transcript message.
- When a run completes through `task_complete`, its `task_complete.result` is the canonical final assistant completion text. Persisted assistant transcript snapshots must keep that canonical completion text aligned with the single user-visible markdown answer even if the run streamed mixed `thinking`, `tool-call`, and `markdown` blocks before completion.
- `ask_user` follows a structured contract (`questions`, `reason_code`, `required_from_user`, `evidence_refs`) and is deterministically validated before entering `waiting_user`; runtime enforcement is limited to capability, schema, evidence, todo, and interaction-contract consistency checks rather than a second semantic policy classifier.
- When a run completes into `waiting_user` through `ask_user`, the final assistant transcript must canonically converge to the structured waiting interaction instead of keeping provisional text-only markdown from earlier no-tool turns.
- Structured prompt answers are submitted through a dedicated prompt-response action rather than the plain chat `sendMessage` path.
- The Env App may auto-submit a waiting prompt only for the narrow single-question, non-secret, pure-choice case with no extra detail requirement or option action; every richer interaction still uses explicit structured submission.
- When a thread is still `waiting_user`, the waiting prompt snapshot in `ai_threads.waiting_user_input_json` should stay aligned with the assistant transcript `ask_user` block; read/write paths recover from the latest persisted assistant transcript when that snapshot is missing or invalid.
- The Env App must distinguish a resolved prompt from a still-waiting thread whose active prompt details are temporarily unavailable; missing prompt state must not be rendered as already handled.
- Thread `title` and `last_message_preview` serve different purposes: `title` is a durable conversation label, while `last_message_preview` is the latest sidebar snippet.
- Empty thread titles stay empty until a dedicated auto-title generator summarizes public user intent; persisting the raw first user message as `title` is not allowed.
- Auto titles are generated from public user-visible text only, recorded with title metadata (`title_source`, input message id, model id, prompt version), and may only fill a still-untitled thread.
- Auto-title generation is a single-purpose background flow with bounded retry backoff. Inside one generation pass, the agent may retry once with a larger output budget when a reasoning-heavy model exhausts the first budget before emitting visible JSON title text; if three generation passes still fail, the agent should stop provider retries, fall back to a truncated first user message as a temporary title, and allow a later user message in that thread to trigger a fresh auto-title attempt.
- Service startup performs a recovery scan for recent still-untitled threads and re-enqueues title generation from the latest persisted public user message, so an agent restart does not strand blank titles.
- Manual rename always wins. Once a thread is manually renamed, later automatic generation must not overwrite that user-owned title state, even if the user intentionally renamed it to blank.
- no-tool backpressure defaults to 3 rounds, but active guided structured continuations may jump directly into a signal-only recovery turn (`ask_user` / `task_complete`) once the threshold is hit so Flower does not waste another generic text-only round.
- Runtime observability for these fast paths should stay explicit through `interaction.contract.classified.classification_mode`, `ask_user.attempt.validation_mode`, and `signal.recovery.attempt`.
- `terminal.exec` output is rendered with structured shell blocks in the Env App (no markdown fallback conversion).
- Live assistant `block-delta` transport must preserve complete user-visible markdown/reasoning content. Provider adapters must keep provider-emitted visible whitespace semantics intact for streamed reasoning fragments so persisted transcripts and live blocks stay human-readable.
- Active-run snapshots are a recovery path for the in-flight assistant turn, not a second transcript source. Once the assistant message has been appended to persisted transcript history, snapshot reads must return empty for that turn so the UI cannot render duplicate assistant answers from both transcript and live state.
- The realtime sink may coalesce low-priority assistant/context updates, but the active thread UI must still converge to the canonical persisted assistant transcript when the run reaches a terminal state, even if some tail realtime frames were missed.
- Subagents are for parallelizable or independently reviewable work. Simple local inspection tasks should stay in the main Flower run instead of spawning subagents.

Installer note:

- `scripts/install.sh` installs pinned ripgrep binaries into `~/.redeven/tools/rg/<version>/<platform>/rg` and links `~/.redeven/bin/rg`, so shell-first search is available even when the system does not provide `rg`.

## Threadstore Persistence Contract

- Flower thread persistence is thread-scoped by default. Deleting a thread removes its transcript rows, queued followups, run records, tool-call records, run events, checkpoints, structured waiting-input rows, todos, thread state, and derived context planes.
- Checkpoint restore follows the same ownership boundary: thread-scoped run/tool/event artifacts that were created after the checkpoint are pruned during restore instead of being left behind as residual history.
- `provider_capabilities` is intentionally a global cache keyed by provider/model and is not deleted with any single thread.
- The current shipped schema keeps semantic memory in `memory_items`. Redeven Agent does not currently ship a separate persistent embeddings table until the runtime fully owns that lifecycle.

## Behavioral evaluation

Flower quality is validated with a behavioral eval harness, not just transcript keyword checks.

The eval harness runs real Flower tasks and asserts:

- final thread state (`run_status`, `execution_mode`, waiting prompt behavior)
- structural tool behavior (`terminal.exec`, `write_todos`, `ask_user`, `task_complete`, forbidden tools)
- runtime events such as `ask_user.waiting`, `todos.updated`, and loop-failure signals
- todo discipline, including final closeout and single `in_progress` execution
- assistant-visible output, evidence paths, and fallback-free closeout

Each eval task runs in an isolated workspace copy so Flower can keep normal RWX permissions without mutating the source repository under test.

See also:
- `PERMISSION_POLICY.md` for how the local RWX cap works (and what it does not cap).
- `CAPABILITY_PERMISSIONS.md` for the complete capability-to-permission mapping.

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
- The wire model id remains `<provider_id>/<model_name>` (stored on each chat thread).
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
- The mode-switch `ask_user` must use structured `questions[]`, and deterministic UI actions belong on `questions[].options[].actions` (for example `[{type:"set_mode",mode:"act"}]`).
- In no-user-interaction runs, Flower cannot ask for a mode switch and must finish with blockers in `task_complete`.
- The Env App shows approval prompts only when `require_user_approval` is enabled.
- `write_todos` is expected for multi-step tasks; exactly one todo should stay in `in_progress`.
- `task_complete` is rejected when todo tracking is active and open todos still exist.
- When a run completes through `task_complete`, its `task_complete.result` is the canonical final assistant completion text. Persisted assistant transcript snapshots must keep that canonical completion text aligned with the user-visible markdown content even if the run streamed mixed `thinking`, `tool-call`, and `markdown` blocks before completion.
- `ask_user` follows a structured contract (`questions`, `reason_code`, `required_from_user`, `evidence_refs`) and is policy-classified by the model before entering `waiting_user`.
- Structured prompt answers are submitted through a dedicated prompt-response action rather than the plain chat `sendMessage` path.
- When a thread is still `waiting_user`, the waiting prompt snapshot in `ai_threads.waiting_user_input_json` should stay aligned with the assistant transcript `ask_user` block; read/write paths recover from the latest persisted assistant transcript when that snapshot is missing or invalid.
- The Env App must distinguish a resolved prompt from a still-waiting thread whose active prompt details are temporarily unavailable; missing prompt state must not be rendered as already handled.
- Thread `title` and `last_message_preview` serve different purposes: `title` is a durable conversation label, while `last_message_preview` is the latest sidebar snippet.
- Empty thread titles stay empty until a dedicated auto-title generator summarizes public user intent; persisting the raw first user message as `title` is not allowed.
- Auto titles are generated from public user-visible text only, recorded with title metadata (`title_source`, input message id, model id, prompt version), and may only fill a still-untitled thread.
- Manual rename always wins. Once a thread is manually renamed, later automatic generation must not overwrite that user-owned title state, even if the user intentionally renamed it to blank.
- no-tool backpressure defaults to 3 rounds and inserts a completion-required nudge before falling back to `ask_user`.
- `terminal.exec` output is rendered with structured shell blocks in the Env App (no markdown fallback conversion).
- Subagents are for parallelizable or independently reviewable work. Simple local inspection tasks should stay in the main Flower run instead of spawning subagents.

Installer note:

- `scripts/install.sh` installs pinned ripgrep binaries into `~/.redeven/tools/rg/<version>/<platform>/rg` and links `~/.redeven/bin/rg`, so shell-first search is available even when the system does not provide `rg`.

See also:
- `PERMISSION_POLICY.md` for how the local RWX cap works (and what it does not cap).
- `CAPABILITY_PERMISSIONS.md` for the complete capability-to-permission mapping.

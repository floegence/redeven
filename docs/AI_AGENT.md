# Flower (Optional)

Redeven can optionally enable **Flower**, an on-device AI assistant inside the Env App UI.

High-level design:

- The browser UI calls the runtime via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go runtime is the security boundary** and executes tools after validating authoritative session metadata.
- External AI-agent integrations use Agent Skills plus the `redeven` CLI target-discovery contract; Redeven does not require or expose an MCP server for that integration path. See [`AGENT_SKILLS.md`](AGENT_SKILLS.md).
- Tooling now uses a structured file-operation surface by default: `file.read` for direct inspection, `file.edit` / `file.write` for deterministic mutations, `terminal.exec` for investigation and verification, and `apply_patch` as a compatibility fallback.
- LLM orchestration runs in the **Go runtime** via native provider SDK adapters:
  - OpenAI: `openai-go` (Responses API)
  - Moonshot: `openai-go` (Chat Completions API on Moonshot base URL)
  - Anthropic: `anthropic-sdk-go` (Messages API)
- GLM/Z.ai, DeepSeek, and Qwen: `openai-go` against provider OpenAI-compatible endpoints with provider-specific request decoration. Qwen3.6 Plus/Flash use the provider Responses API `web_search` tool.
- In Desktop-managed SSH Host sessions, the runtime may also use a Desktop AI Broker adapter. Desktop binds that adapter through runtime-control after the running SSH runtime reports the `desktop_ai_broker` capability. The broker performs model calls on the user's machine with the Desktop Local Environment's provider config and secrets, while the SSH-hosted runtime still owns context gathering, permission checks, and tool execution on the SSH host.
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
  - environment facts such as shell, runtime home, approval policy, dangerous-command blocking, and whether subagent delegation is available;
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

Enable Flower by adding an `ai` section to the runtime config file (default Local Environment config: `~/.redeven/local-environment/config.json`). The detailed provider schema, model allow-lists, web-search policy, examples, and secret-handling rules live in [`AI_SETTINGS.md`](AI_SETTINGS.md).

The core runtime contract is:

- Providers own their allowed model list in `ai.providers[].models[]`.
- `ai.current_model_id` selects the default model for new chats.
- The wire model id remains `<provider_id>/<model_name>`, and each thread stores its own `model_id`.
- Provider API keys are stored in the Local Environment state's `secrets.json`, never in `config.json`, and are never returned to the browser in plaintext.
- For Desktop-managed SSH Host sessions, the remote runtime can use a short-lived Desktop AI Broker source without copying the Desktop Local Environment's `ai` config or secrets onto the SSH host.

## Tooling and execution policy

Built-in tools:

- `file.read`
- `file.edit`
- `file.write`
- `terminal.exec`
- `apply_patch`
- `write_todos`
- `exit_plan_mode`
- `web.search` (optional; exposed only for `openai_compatible` providers with `providers[].web_search.mode = "brave"`)

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
- `ask_user`, `exit_plan_mode`, and `task_complete` are runtime-owned signal tools. They are persisted and deterministically validated before the thread enters `waiting_user` or a terminal state.
- `ask_user` uses the canonical question-level response contract (`response_mode`, `choices[]`, and `choices_exhaustive` for choice-based questions). The visible question belongs inside the structured payload, not in a duplicate markdown questionnaire.
- Guided structured interactions are classified into an interaction contract and preserved across prompts, validation, waiting-user rendering, and continuation turns.
- No-user-interaction runs must finish through `task_complete`; delegated child runs use the `subagent_autonomous` prompt profile and report to their parent, not directly to the end user.
- The Env App shows approval prompts only when `require_user_approval` is enabled.
- `write_todos` is expected for multi-step tasks; exactly one todo should stay in `in_progress`, and `task_complete` is rejected while tracked todos remain open.
- Runtime-assisted closeout can recover a clean completion after verified work, but interrupted, canceled, or timed-out runs keep their interruption outcome.
- Flower keeps one canonical visible answer slot per assistant run. The Env App renders settled transcript rows separately from one live assistant tail and must not display the same assistant message through both surfaces.
- Thread titles are generated by a dedicated auto-title flow from public user-visible text only; manual rename always wins.
- Ask Flower handoffs from Files, Terminal, Monitor, and Git use Context Action envelopes for source surface, target locality, structured context items, and suggested working directory.
- Flower thread read/unread state is runtime-authoritative through per-user read watermarks and `read_status` payloads, not browser-local storage.

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

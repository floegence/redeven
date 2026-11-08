---
type: Qualification Contract
title: Flower Ollama task qualification
tags: [flower, ollama, tasks, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Explicit Ollama qualification uses the installed model, production Flower and published Floret. Verify real tool effects, files, processes, canonical views and streams. Failures remain failures without simulated substitutes or automatic reruns. Tests own cleanup and preserve source credentials/configuration.

# Contract

Explicit scripts/check_flower_tasks_ollama.sh uses the selected installed model, exact Ollama Chat history and real model-chosen tools; --interleavings adds combined cases. Check actual effects/canonical state, retaining failures without simulation or automatic reruns.

Required cases:
- Read/sum/write/verify structured data and modify it in a later turn.
- Stop generation or owned terminal: preserve confirmed effects, prevent delayed writes, accept later work; cancellation is not failure-retried.
- Queue optimistic edit/stale rejection/order/delete, exact executed user order, Send now cancellation/promotion and conflicting duplicate keys.
- Stop/restart at generation/approval/Ask User; stale answers cannot execute, retained queue promotes once. Queue edits during approval preserve this boundary.
- Duplicate approval replays across restart, conflicting answer rejects, exactly one effect. Canceled Ask User cannot revive work.
- Two interrupted continuations plus concurrent Retry/queued input preserve original write once. Duplicate Send now rejects consumed edits/reexecution.
- Queued permission updates, rejected active-model changes and immutable approvals; repeated readonly/approval/full-access transitions include stop/restart, stale/fresh approvals, post-effect failures and downgrade/retry.

Own and remove temporary stores/files/services/processes, preserve reports and unchanged source configuration/credentials.

# Boundaries

[Thread runtime](../ai/floret-thread-runtime.md) owns command/cancellation/queue/Retry
semantics. Controlled transport faults qualify recovery, not natural endpoint
reliability. Passing service tests does not certify Desktop click-through with the
live model. Deterministic delegation/permission tests remain separate evidence.

# Evidence

- `redeven:scripts/check_flower_tasks_ollama.sh`: explicit published-dependency runner.
- `redeven:internal/ai/run_e2e_ollama_tasks_test.go`: model-driven effects, faults and product commands.
- Deterministic cases cover role-free schema, exact delegation text, all three inherited
  permission modes, historical readonly and canonical steering/spawn replay.

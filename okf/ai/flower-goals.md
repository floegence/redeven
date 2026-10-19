---
type: AI Interaction Contract
title: Flower thread Goals
description: Manage one concise objective and reflect in the same execution context before natural completion.
tags: [ai, flower, goals, recovery]
timestamp: 2026-10-18T00:00:00Z
---
# Summary

Published Floret owns the canonical Goal, model tool, reflection and completion.
Redeven authorizes mutations and presents the typed facts. One current Goal per
thread describes the desired result clearly and concisely without a text-length
recommendation, ceiling or truncation. Goal never depends on Todo. Stop, thread
navigation and recovery remain available; an unresolved request never claims a
successful mutation or completion.

# Contract

## Goal ownership and execution

User and model updates enter Floret's shared journal writer with request identity
and expected version. Exact replay preserves one fact; conflict returns the
current version without changing it. The model may maintain a user Goal while
preserving unfinished requirements. User deletion suppresses automatic recreation
for the same task; approvals, answers, retry, compaction and restart are not new
tasks. Ordinary Fork inherits the Goal at its branch point and evolves independently.
A delegated child manages its own mission Goal.

Mutations do not start execution or interrupt a request. They appear immediately
and affect the next new logical model request, including requests within the
current Turn. Frozen transport retries retain the original input. Floret appends
typed runtime facts and preserves stable instructions, tools and provider
continuation. Cache reuse is measured from actual request usage; no hit rate is
promised. Compaction retains exact control facts beside its summary.

At a natural stop, the same executing model checks the current Goal, user
constraints and existing results. It finishes remaining work, uses the existing
question mechanism for a necessary decision, or honestly reports a blocker while
retaining the Goal. It reuses existing evidence and runs only necessary missing
verification. Plans, attempts and unverified assumptions are not completion.
There is no separate reviewer, fabricated user message or background wakeup.

The independent goal tool supports set, delete and review. Set cannot mark
completion. A review is completed, continue or blocked with brief evidence and is
bound to Goal version and execution position. Later work, steering or Goal changes
invalidate it. Completed appears only with a valid successful terminal commit.
Model deletion cannot substitute for a review. The existing two forced
continuations per Turn remain shared across retries and Goal edits. Exhaustion
retains the Goal and exposes the existing recoverable failure path. Stop cancels
execution and reflection; deletion only cancels future Goal checks.

## Interaction and recovery

/goal opens the inline composer panel; /goal text creates or replaces the Goal;
/goal clear deletes it. The composer summary opens the same panel. Escape closes
it and restores focus. Creation, updates, deletion and completion show actor and
history; reflection uses a lightweight status. Editing remains available during
execution, questions and approval. New-conversation Goal creation saves settings
and Goal only, with no model call or invented Turn.

The existing short-lived outbox freezes each request. An unknown outcome retries
the exact request identity and content. A mutation or current-view failure after
possible commit returns AI_GOAL_OUTCOME_UNKNOWN; server failures retain unknown
outcome semantics in both transports. Removing its local recovery copy does not
cancel a possibly committed server mutation. Version conflicts preserve edits and
allow an explicit new submission against the returned version. Editor text belongs
to the thread's ComposerDraftStore scope, including switching and restart.
Commands consume only their unchanged command text; newer text, references and
attachments remain intact. New-thread send and Goal creation share preparation
exclusion so a pending operation cannot create a second conversation.

Creating a Goal moves the draft to the canonical thread without changing its
attachment scope. Before the retained draft sends, the existing scope is bound
once to the authorized thread using its exact capability and original target.
Existing-thread staging cannot move to another thread. Binding is idempotent,
keeps upload identities, and atomically updates existing resource references.
An upload already receiving commits against the scope's current target, so it
survives the move. A failed binding leaves the draft available for retry; no
cross-thread target validation is relaxed and no attachment is uploaded twice.

# Boundaries

## Todo

Default Flower tools, capability lists and prompts omit write_todos and current
Todo state. Removed default initialization and update paths do not continue in
the background. Published compatibility interfaces and historical presentation
remain readable. Old Todo records are neither current instructions nor Goal
input. Deleting Todo later requires no change to Goal execution or interaction.

# Evidence

- redeven:internal/ai/thread_goal.go — authorization and typed mutation mapping.
- redeven:internal/ai/thread_goal_test.go — empty creation, provider reflection,
  replay, conflicts, lost-response recovery, Stop during reflection, default Todo
  exclusion and retained attachment submission.
- redeven:internal/ai/thread_goal_interactions_test.go — Goal updates while waiting
  for a question or approval reach the next model request without repeating effects;
  historical Todo remains readable without influencing Goal completion.
- redeven:internal/ai/threadstore/upload_staging.go — resource binding and in-flight upload settlement.
- redeven:internal/flower_ui/src/FlowerSurface.tsx — inline management, commands and outbox handoff.
- redeven:internal/envapp/ui_src/src/ui/FlowerSurface.goal.browser.test.tsx — keyboard, draft preservation, conflicts and unknown recovery.
- redeven:scripts/check_floret_dependency_boundary.sh — released upstream capability boundary.

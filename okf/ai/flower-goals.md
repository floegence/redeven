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

Explicit command submission delegates one atomic Goal update and idle-only Turn
admission to Floret. New, idle, completed and user-stopped threads start work with
the submitted text as actual user input and preserve previous context. Active
execution only updates the Goal, without queuing a Turn. Questions and approvals
remain waiting for their original response. Popup saves and deletion never start
execution; deletion does not stop it. Changes appear immediately and affect the
next new logical model request, including requests within the current
Turn. Frozen transport retries retain the original input. Floret appends
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

Selecting or entering /goal opens an in-composer command chip. Entering the mode
alone creates no thread and performs no work. Enter submits the Goal; Escape,
the chip close button and Backspace on empty input leave the mode. Ordinary text,
attachments, references and pending question answers remain in their draft scope.
/goal clear remains the explicit delete command.

Without a Goal, no Goal control is rendered. With one, a compact borderless,
softly tinted rounded-rectangle badge with the shared target-and-arrow icon sits
to the right of the progress indicator on the same row. It opens an anchored
popup with the full editable text and delete control; save and cancel appear
for edits.
The popup uses a soft elevation shadow without a visible border or a surrounding
input focus frame. Keyboard focus remains visible on individual controls.
Escape and outside dismissal preserve unsaved text, while cancel discards it.
Creation, updates, deletion and completion use one expandable icon row: action,
single-line Goal preview and disclosure chevron. Set and update share the Goal-set
label; completion is reported only by the canonical completion fact. Expansion
shows only the full original text aligned with the action label, directly on the
transcript without a card, border or tinted background. Actor metadata remains
in canonical history but is not displayed in Goal rows. CSS ellipsis
affects only the preview; it never truncates the stored or expanded Goal.
Goal review tools use the same target-and-arrow icon in a quiet single line,
without duration, actor labels or generic tool field names. Pending reviews say
Checking goal; confirmed continue and blocked reviews say Goal not yet complete
or Goal blocked with the saved brief evidence. A completed review says Goal
checked until canonical completion exists; tool success never implies completion.
Expansion shows the invocation's original objective and evidence directly on the
transcript, without a card or border. Later Goal edits never replace that text.
Unknown historical data says Goal check · Details unavailable and has no empty
disclosure. The released Floret typed activity projection owns historical
recovery; Redeven never reads private storage or reconstructs review outcomes.
Reflection uses a lightweight status. The transcript action menu also exposes
/goal during questions and approvals without resolving or bypassing them.

Product authorization is persisted under Floret's public
GoalSubmissionRequestKey using the existing execution authority contract. Floret
owns admission, preparation, failure and cancellation; Redeven does not mirror
its lifecycle. A preparation failure retains the saved Goal and ordinary failure
recovery. An exact retry retains the original admission decision even after Stop,
completion or restart; a fresh submission may start a new execution. Goal updates
and deletion never restart the execution they originally only updated.

Goal tools and typed changes with canonical turn/run ownership share that turn's
[process disclosure](../ui/flower-turn-process-disclosure.md). Independent user
edits without that ownership stay visible. Goal editing, recovery, Stop and
navigation remain available during execution, questions and approval.

The timeline presents a canonical model Goal change in place of its single
preceding successful Goal invocation within the same turn/run and canonical
positions. The underlying source message remains unchanged for history and
diagnostics.
Ambiguous batches, unmatched reviews, errors, cancellation, approval and attention
states keep their tool rows and use the same Goal icon. A user edit or another
execution cannot serve as a successful tool receipt. This is presentation only;
it does not infer completion or add a Goal state owner.

The existing short-lived outbox freezes each request. An unknown outcome retries
the exact request identity and content. A mutation or current-view failure after
possible commit returns AI_GOAL_OUTCOME_UNKNOWN; server failures retain unknown
outcome semantics in both transports. Removing its local recovery copy does not
cancel a possibly committed server mutation. Version conflicts preserve edits and
allow an explicit new submission against the returned version. Editor text belongs
to the thread's ComposerDraftStore scope, including switching and restart.
Successful commands consume only the unchanged submitted draft revision; newer
text, including edits that return to the same text, references and attachments
remain intact. A conflict preserves command mode and resubmits as a command,
while popup conflicts remain save-only edits. New-thread send and Goal creation
share preparation exclusion so a pending operation cannot create a second conversation.

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
- redeven:internal/ai/thread_goal_submit_test.go — idle admission, active updates, Stop, exact replay and execution authorization.
- redeven:internal/codeapp/appserver/server_ai_goal_test.go — HTTP save-only and submission contracts.
- redeven:internal/flower_ui/src/FlowerSurface.tsx — command chip, anchored popup and outbox handoff.
- redeven:internal/envapp/ui_src/src/ui/FlowerSurface.goal.browser.test.tsx — keyboard, draft preservation, conflicts and unknown recovery.
- redeven:scripts/check_floret_dependency_boundary.sh — released upstream capability boundary.

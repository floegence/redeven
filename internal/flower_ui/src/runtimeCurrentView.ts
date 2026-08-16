import type {
  FlowerActivityApprovalState,
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerRuntimeCurrentItem,
  FlowerRuntimeCurrentView,
  FlowerRuntimeInteraction,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mapFlowerActivityItem } from './flowerLiveMapper';
import { canonicalFlowerThreadSnapshotTitle } from './flowerThreadTitle';

type ResolvedApprovalState = Exclude<FlowerActivityApprovalState, 'requested'>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function messageStatus(view: FlowerRuntimeCurrentView, item: FlowerRuntimeCurrentItem): FlowerChatMessage['status'] {
  if (item.kind === 'assistant' && view.activity === 'active' && item.turn_id === view.turn_id) return 'streaming';
  if (view.last_outcome === 'cancelled' && item.turn_id === view.turn_id) return 'canceled';
  return 'complete';
}

function itemCreatedAt(item: FlowerRuntimeCurrentItem, fallback: number): number {
  const parsed = Date.parse(String(item.created_at ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function itemReferences(item: FlowerRuntimeCurrentItem): FlowerChatMessage['references'] {
  const references = (item.references ?? []).map((reference) => ({
    reference_id: trim(reference.reference_id),
    kind: reference.kind,
    label: trim(reference.label),
    ...(reference.text !== undefined ? { text: String(reference.text) } : {}),
    ...(reference.truncated ? { truncated: true } : {}),
  })).filter((reference) => reference.reference_id && reference.label);
  for (const [index, attachment] of (item.attachments ?? []).entries()) {
    const label = trim(attachment.name);
    if (!label) continue;
    references.push({ reference_id: `attachment:${trim(item.id)}:${index}`, kind: 'file', label });
  }
  return references.length > 0 ? references : undefined;
}

function activityItem(raw: Readonly<Record<string, unknown>>, effectRetry?: FlowerActivityItem['effect_retry']): FlowerActivityItem {
  const mapped = mapFlowerActivityItem(raw);
  if (!mapped) {
    throw new Error('Flower contract error: typed current tool item requires an activity item identity.');
  }
  return effectRetry ? { ...mapped, effect_retry: effectRetry } : mapped;
}

function resolvedApprovalState(interaction: FlowerRuntimeInteraction): ResolvedApprovalState | undefined {
  const outcome = trim(interaction.resolution?.outcome).toLowerCase();
  if (outcome === 'cancelled' || outcome === 'canceled') return 'canceled';
  if (outcome === 'timed_out') return 'timed_out';
  if (outcome === 'rejected') return 'rejected';
  if (outcome === 'approved') return 'approved';
  const approved = interaction.resolution?.approved ?? interaction.approved;
  if (approved === true) return 'approved';
  if (approved === false) return 'rejected';
  return undefined;
}

function mergeResolvedApproval(activity: FlowerActivityItem, interaction: FlowerRuntimeInteraction): FlowerActivityItem {
  const approvalState = resolvedApprovalState(interaction);
  if (!approvalState) return activity;
  const attentionReasons = activity.attention_reasons?.filter((reason) => reason !== 'approval' && reason !== 'waiting');
  const base = {
    ...activity,
    approval_state: approvalState,
    ...(attentionReasons?.length ? { attention_reasons: attentionReasons } : { attention_reasons: undefined }),
  };
  switch (approvalState) {
    case 'approved':
      return {
        ...base,
        status: activity.status === 'waiting' ? 'pending' : activity.status,
        severity: activity.status === 'waiting' ? 'normal' : activity.severity,
        needs_attention: activity.status === 'waiting' ? false : activity.needs_attention,
        requires_approval: true,
      };
    case 'rejected':
      return { ...base, status: 'declined', severity: 'quiet', needs_attention: false, requires_approval: false };
    case 'canceled':
      return { ...base, status: 'canceled', severity: 'warning', needs_attention: false, requires_approval: true };
    case 'timed_out':
      return { ...base, status: 'error', severity: 'blocking', needs_attention: true, requires_approval: true };
  }
}

function activityBlock(base: FlowerThreadSnapshot, view: FlowerRuntimeCurrentView, item: FlowerRuntimeCurrentItem): FlowerActivityTimelineBlock {
  const activityIdentity = trim(item.activity?.tool_id) || trim(item.id);
  const retry = (view.interactions ?? []).find((interaction) => (
    interaction.kind === 'effect_retry'
    && !interaction.resolved
    && interaction.effect_retry
    && (trim(interaction.tool_call_id) || trim(interaction.effect_retry.tool_call_id)) === activityIdentity
  ))?.effect_retry;
  let activity = activityItem(item.activity ?? {}, retry ? {
    effect_attempt_id: trim(retry.effect_attempt_id),
    tool_call_id: trim(retry.tool_call_id),
  } : undefined);
  const toolCallID = trim(item.activity?.tool_id);
  const resolvedApproval = toolCallID ? (view.interactions ?? []).find((interaction) => (
    interaction.kind === 'approval'
    && interaction.resolved
    && (trim(interaction.tool_call_id) || trim(interaction.approval?.tool_call_id)) === toolCallID
  )) : undefined;
  if (resolvedApproval) activity = mergeResolvedApproval(activity, resolvedApproval);
  const fileActions = Object.fromEntries((activity.target_refs ?? []).flatMap((target) => {
    const actionID = trim(target.kind).startsWith('file_action:')
      ? trim(target.kind).slice('file_action:'.length)
      : '';
    if (!actionID) return [];
    return [[actionID, {
      action_id: actionID,
      display_name: trim(target.label) || actionID,
      can_preview: true,
      can_browse_directory: true,
    }]];
  }));
  return {
    type: 'activity-timeline',
    schema_version: 1,
    thread_id: base.thread_id,
    turn_id: trim(item.turn_id) || trim(view.turn_id),
    run_id: trim(item.interaction?.run_id) || trim(view.turn_id),
    summary: {
      status: activity.status,
      severity: activity.severity,
      needs_attention: activity.needs_attention,
      total_items: 1,
      counts: { [activity.status]: 1 },
    },
    items: [activity],
    ...(Object.keys(fileActions).length > 0 ? { file_actions: fileActions } : {}),
  };
}

function runtimeMessages(base: FlowerThreadSnapshot, view: FlowerRuntimeCurrentView): readonly FlowerChatMessage[] {
  const messages: FlowerChatMessage[] = [];
  for (const item of view.items ?? []) {
    const createdAtMs = itemCreatedAt(item, base.updated_at_ms);
    const references = itemReferences(item);
    if (item.kind === 'interaction') {
      const interaction = item.interaction;
      if (!interaction?.resolved) continue;
      if (interaction.kind === 'input') {
        const values = interaction.resolution?.redacted
          ? []
          : Object.values(interaction.resolution?.input ?? {}).map(String).map(trim).filter(Boolean);
        messages.push({
          id: trim(item.id), thread_id: base.thread_id, turn_id: trim(item.turn_id), role: 'user',
          content: values.join('\n'), status: 'complete', created_at_ms: createdAtMs,
          ...(references ? { references } : {}),
        });
        continue;
      }
      continue;
    }
    if (item.kind === 'tool') {
      messages.push({
        id: trim(item.id), thread_id: base.thread_id, turn_id: trim(item.turn_id), role: 'assistant',
        content: '', status: 'complete', created_at_ms: createdAtMs,
        blocks: [activityBlock(base, view, item)],
        ...(references ? { references } : {}),
      });
      continue;
    }
    messages.push({
      id: trim(item.id), thread_id: base.thread_id, turn_id: trim(item.turn_id),
      role: item.kind === 'user' ? 'user' : 'assistant', content: String(item.text ?? ''),
      status: messageStatus(view, item), created_at_ms: createdAtMs,
      ...(references ? { references } : {}),
    });
  }
  const assistantDraft = String(view.assistant_draft ?? '');
  const thinkingDraft = String(view.thinking_draft ?? '');
  if (thinkingDraft) {
    messages.push({
      id: `thinking:${trim(view.turn_id) || base.thread_id}`, thread_id: base.thread_id, turn_id: trim(view.turn_id),
      role: 'assistant', content: '', status: 'streaming', created_at_ms: base.updated_at_ms,
      blocks: [{ type: 'thinking', content: thinkingDraft }], live: true,
    });
  }
  if (assistantDraft) {
    messages.push({
      id: `draft:${trim(view.turn_id) || base.thread_id}`, thread_id: base.thread_id, turn_id: trim(view.turn_id),
      role: 'assistant', content: assistantDraft, status: 'streaming', created_at_ms: base.updated_at_ms,
      live: true, active_cursor: true,
    });
  }
  return messages;
}

function runtimeApprovalActions(
  base: FlowerThreadSnapshot,
  view: FlowerRuntimeCurrentView,
): NonNullable<FlowerThreadSnapshot['approval_actions']> {
  const pending = (view.interactions ?? []).filter((interaction) => (
    interaction.kind === 'approval' && !interaction.resolved && interaction.approval
  ));
  return pending.map((interaction, index) => {
    const approval = interaction.approval!;
    return {
      action_id: trim(interaction.id),
      origin: 'main_tool' as const,
      run_id: trim(interaction.turn_id) || trim(view.turn_id),
      turn_id: trim(interaction.turn_id) || trim(view.turn_id),
      tool_id: trim(interaction.tool_call_id) || trim(approval.tool_call_id),
      tool_name: trim(approval.tool_name),
      state: 'requested' as const,
      status: 'pending' as const,
      surface_role: 'primary_action' as const,
      requested_at_ms: base.updated_at_ms,
      can_approve: true,
      queue_order: index + 1,
      batch_index: index + 1,
      batch_size: pending.length,
      summary: {
        label: trim(approval.label) || trim(approval.tool_name),
        ...(trim(approval.description) ? { description: trim(approval.description) } : {}),
        ...(trim(approval.command) ? { command: trim(approval.command) } : {}),
        ...(approval.effects?.length ? { effects: [...approval.effects] } : {}),
        ...(approval.targets?.length ? {
          targets: approval.targets.map((target) => ({ kind: 'resource', label: target })),
        } : {}),
      },
    };
  });
}

function runtimeInputRequest(
  view: FlowerRuntimeCurrentView,
): FlowerThreadSnapshot['input_request'] {
  const interaction = (view.interactions ?? []).find((candidate) => (
    candidate.kind === 'input' && !candidate.resolved && candidate.input
  ));
  if (!interaction?.input) return undefined;
  if (!trim(interaction.id)) {
    throw new Error('Flower contract error: typed current input interaction requires an id.');
  }
  if (!trim(interaction.turn_id) && !trim(view.turn_id)) {
    throw new Error('Flower contract error: typed current input interaction requires a turn id.');
  }
  if (interaction.input.questions.length === 0) {
    throw new Error('Flower contract error: typed current input interaction requires at least one question.');
  }
  for (const question of interaction.input.questions) {
    if (!trim(question.id) || !trim(question.prompt) || !trim(question.kind)) {
      throw new Error('Flower contract error: typed current input question requires id, prompt, and kind.');
    }
  }
  const reasonCode = interaction.input.questions
    .map((question) => trim(question.kind))
    .find(Boolean);
  return {
    prompt_id: trim(interaction.id),
    message_id: trim(interaction.turn_id) || trim(view.turn_id),
    tool_id: trim(interaction.id),
    tool_name: 'ask_user',
    required_from_user: interaction.input.questions.map((question) => trim(question.id)).filter(Boolean),
    questions: interaction.input.questions.map((question) => {
      const options = (question.options ?? []).map(trim).filter(Boolean);
      return {
        id: trim(question.id),
        header: trim(question.prompt),
        question: trim(question.prompt),
        is_secret: question.secret === true,
        response_mode: options.length > 0
          ? (trim(question.write_label) ? 'select_or_write' as const : 'select' as const)
          : 'write' as const,
        choices_exhaustive: options.length > 0 && !trim(question.write_label),
        ...(trim(question.write_label) ? { write_label: trim(question.write_label) } : {}),
        choices: options.map((option) => ({
          choice_id: option,
          label: option,
          kind: 'select' as const,
        })),
      };
    }),
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    public_summary: trim(interaction.input.summary),
    contains_secret: interaction.input.questions.some((question) => question.secret === true),
  };
}

export function applyFlowerRuntimeCurrentView(
  base: FlowerThreadSnapshot,
  current: FlowerRuntimeCurrentView,
): FlowerThreadSnapshot {
  const threadID = trim(current.thread_id);
  if (!threadID || threadID !== base.thread_id) return base;
  const pending = (current.interactions ?? []).filter((interaction) => !interaction.resolved);
  const approvalCount = pending.filter((interaction) => interaction.kind === 'approval').length;
  const hasInput = pending.some((interaction) => interaction.kind === 'input');
  const status: FlowerThreadSnapshot['status'] = hasInput
    ? 'waiting_user'
    : approvalCount > 0
      ? 'waiting_approval'
      : current.activity === 'active'
        ? 'running'
        : current.last_outcome === 'failed'
          ? 'failed'
          : current.last_outcome === 'cancelled'
            ? 'canceled'
            : current.last_outcome === 'completed'
              ? 'success'
              : 'idle';
  const messages = runtimeMessages(base, current);
  const approvalActions = runtimeApprovalActions(base, current);
  const inputRequest = runtimeInputRequest(current);
  const queuedTurns = (current.queue ?? []).map((queued) => ({
    queue_id: trim(queued.id),
    prompt: String(queued.input?.text ?? ''),
    created_at_ms: base.updated_at_ms,
  }));
  const projected: FlowerThreadSnapshot = {
    ...base,
    updated_at_ms: base.updated_at_ms,
    status,
    active_run_id: status === 'running' || status === 'waiting_approval' ? trim(current.turn_id) || base.active_run_id : undefined,
    approval_pending: approvalCount > 0,
    approval_pending_count: approvalCount,
    approval_actions: approvalActions,
    input_request: inputRequest,
    queued_turn_count: queuedTurns.length,
    queued_turns: queuedTurns,
    messages,
    error: undefined,
  };
  return { ...projected, title: canonicalFlowerThreadSnapshotTitle(projected) };
}

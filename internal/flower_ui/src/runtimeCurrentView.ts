import type {
  FlowerActivityApprovalState,
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerRuntimeCurrentItem,
  FlowerRuntimeCurrentView,
  FlowerRuntimeInteraction,
  FlowerRunProgress,
  FlowerRunProgressPhase,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { mapFlowerActivityItem } from './flowerLiveMapper';
import { canonicalFlowerThreadSnapshotTitle } from './flowerThreadTitle';
import { flowerAttachmentDisplayKind, safeFlowerAttachmentURL } from './attachments/flowerAttachmentPresentation';
import { inputResponseBlockFromInteraction, inputResponseVisibleText } from './inputResponse';

type ResolvedApprovalState = Exclude<FlowerActivityApprovalState, 'requested'>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

type RuntimeExecutionIdentity = Readonly<{ turnID: string; runID: string }>;

function runtimeInteractionIdentity(interaction: FlowerRuntimeInteraction): RuntimeExecutionIdentity {
  const interactionID = trim(interaction.id);
  const turnID = trim(interaction.turn_id);
  const runID = trim(interaction.run_id);
  if (!interactionID || !turnID || !runID) {
    throw new Error('Flower contract error: current interaction requires exact id, turn_id, and run_id.');
  }
  return { turnID, runID };
}

function runtimeItemIdentity(item: FlowerRuntimeCurrentItem): RuntimeExecutionIdentity {
  const itemID = trim(item.id);
  const turnID = trim(item.turn_id);
  const runID = trim(item.run_id);
  if (!itemID || !turnID || !runID) {
    throw new Error('Flower contract error: current item requires exact id, turn_id, and run_id.');
  }
  if (item.interaction) {
    const interaction = runtimeInteractionIdentity(item.interaction);
    if (interaction.turnID !== turnID || interaction.runID !== runID) {
      throw new Error('Flower contract error: current item and interaction execution identity differ.');
    }
  }
  return { turnID, runID };
}

function runtimeRunProgressPhase(value: unknown): FlowerRunProgressPhase {
  switch (trim(value)) {
    case 'preparing':
    case 'waiting_response':
    case 'streaming':
    case 'retrying':
    case 'finalizing':
    case 'tool_execution':
      return trim(value) as FlowerRunProgressPhase;
    default:
      throw new Error(`Flower contract error: unsupported run progress phase ${trim(value) || '<empty>'}.`);
  }
}

function runtimeRunProgress(current: FlowerRuntimeCurrentView): FlowerRunProgress | null {
  if (!current.run_progress) return null;
  const runID = trim(current.run_id);
  const turnID = trim(current.turn_id);
  if (!runID || !turnID) {
    throw new Error('Flower contract error: run progress requires exact run_id and turn_id.');
  }
  return { run_id: runID, turn_id: turnID, phase: runtimeRunProgressPhase(current.run_progress.phase) };
}

function approvalTarget(value: unknown): { kind: string; label: string } | null {
  const encoded = trim(value);
  if (!encoded) return null;
  const separator = encoded.indexOf(':');
  if (separator <= 0) return { kind: 'resource', label: encoded };
  const kind = trim(encoded.slice(0, separator));
  const label = trim(encoded.slice(separator + 1));
  if (!kind || !label) return { kind: 'resource', label: encoded };
  return { kind, label };
}

function messageStatus(view: FlowerRuntimeCurrentView, item: FlowerRuntimeCurrentItem): FlowerChatMessage['status'] {
  if (item.live) return 'streaming';
  if (view.last_outcome === 'cancelled' && item.turn_id === view.turn_id) return 'canceled';
  if (view.last_outcome === 'interrupted' && item.turn_id === view.turn_id) return 'error';
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
  return references.length > 0 ? references : undefined;
}

function attachmentBlocks(attachments: readonly Readonly<{
  name: string;
  mime_type?: string;
  size_bytes?: number;
  url?: string;
}>[] | undefined): NonNullable<FlowerChatMessage['blocks']> {
  const blocks: Array<NonNullable<FlowerChatMessage['blocks']>[number]> = [];
  for (const attachment of attachments ?? []) {
    const name = trim(attachment.name);
    const mimeType = trim(attachment.mime_type);
    const size = Number(attachment.size_bytes);
    if (!name || !mimeType || !Number.isFinite(size) || size < 0) continue;
    const url = safeFlowerAttachmentURL(attachment.url);
    if (flowerAttachmentDisplayKind(mimeType) === 'image' && url) {
      blocks.push({ type: 'image', src: url, alt: name });
      continue;
    }
    blocks.push({
      type: 'file' as const,
      name,
      size: Math.floor(size),
      mimeType,
      ...(url ? { url } : {}),
    });
  }
  return blocks;
}

function itemAttachmentBlocks(item: FlowerRuntimeCurrentItem): NonNullable<FlowerChatMessage['blocks']> {
  return attachmentBlocks(item.attachments);
}

function activityItem(raw: Readonly<Record<string, unknown>>): FlowerActivityItem {
  const mapped = mapFlowerActivityItem(raw);
  if (!mapped) {
    throw new Error('Flower contract error: typed current tool item requires an activity item identity.');
  }
  return mapped;
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

function activityBlock(base: FlowerThreadSnapshot, view: FlowerRuntimeCurrentView, item: FlowerRuntimeCurrentItem, identity: RuntimeExecutionIdentity): FlowerActivityTimelineBlock {
  let activity = activityItem(item.activity ?? {});
  const toolCallID = trim(item.activity?.tool_id);
  const resolvedApproval = toolCallID ? (view.interactions ?? []).find((interaction) => (
    interaction.kind === 'approval'
    && interaction.resolved
    && trim(interaction.turn_id) === identity.turnID
    && trim(interaction.run_id) === identity.runID
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
    turn_id: identity.turnID,
    run_id: identity.runID,
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
  const seenItemIDs = new Set<string>();
  for (const item of view.items ?? []) {
    const identity = runtimeItemIdentity(item);
    const itemID = trim(item.id);
    if (!itemID || seenItemIDs.has(itemID)) continue;
    seenItemIDs.add(itemID);
    const createdAtMs = itemCreatedAt(item, base.updated_at_ms);
    const references = itemReferences(item);
    const attachmentBlocks = itemAttachmentBlocks(item);
    if (item.kind === 'interaction') {
      const interaction = item.interaction;
      if (!interaction?.resolved) continue;
      if (interaction.kind === 'input') {
        const block = inputResponseBlockFromInteraction(interaction);
        if (!block) continue;
        messages.push({
          id: itemID, thread_id: base.thread_id, turn_id: identity.turnID, run_id: identity.runID, role: 'user',
          content: inputResponseVisibleText(block), status: 'complete', created_at_ms: createdAtMs,
          blocks: [block],
          ...(references ? { references } : {}),
        });
        continue;
      }
      continue;
    }
    if (item.kind === 'tool') {
      messages.push({
        id: itemID, thread_id: base.thread_id, turn_id: identity.turnID, run_id: identity.runID, role: 'assistant',
        content: '', status: 'complete', created_at_ms: createdAtMs,
        blocks: [activityBlock(base, view, item, identity)],
        ...(references ? { references } : {}),
      });
      continue;
    }
    if (item.kind === 'thinking') {
      messages.push({
        id: itemID, thread_id: base.thread_id, turn_id: identity.turnID, run_id: identity.runID, role: 'assistant',
        content: '', status: messageStatus(view, item), created_at_ms: createdAtMs,
        blocks: [{ type: 'thinking', content: String(item.text ?? '') }],
        ...(item.live ? { live: true } : {}),
        ...(references ? { references } : {}),
      });
      continue;
    }
    messages.push({
      id: itemID, thread_id: base.thread_id, turn_id: identity.turnID, run_id: identity.runID,
      role: item.kind === 'user' ? 'user' : 'assistant', content: String(item.text ?? ''),
      status: messageStatus(view, item), created_at_ms: createdAtMs,
      ...(attachmentBlocks.length > 0 ? { blocks: attachmentBlocks } : {}),
      ...(item.live ? { live: true, active_cursor: item.kind === 'assistant' } : {}),
      ...(references ? { references } : {}),
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
    const identity = runtimeInteractionIdentity(interaction);
    const approval = interaction.approval!;
    return {
      action_id: trim(interaction.id),
      origin: 'main_tool' as const,
      run_id: identity.runID,
      turn_id: identity.turnID,
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
          targets: approval.targets.map(approvalTarget).filter((target) => target !== null),
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
  const identity = runtimeInteractionIdentity(interaction);
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
    message_id: identity.turnID,
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
  if (!threadID || threadID !== base.thread_id) {
    throw new Error('Flower contract error: current thread_id does not match the selected thread.');
  }
  for (const interaction of current.interactions ?? []) runtimeInteractionIdentity(interaction);
  const pending = (current.interactions ?? []).filter((interaction) => !interaction.resolved);
  const approvalCount = pending.filter((interaction) => interaction.kind === 'approval').length;
  const hasInput = pending.some((interaction) => interaction.kind === 'input');
  const runtimeError = trim(current.error);
  const status: FlowerThreadSnapshot['status'] = hasInput
    ? 'waiting_user'
    : approvalCount > 0
      ? 'waiting_approval'
      : runtimeError
        ? 'failed'
        : current.activity === 'active'
          ? 'running'
          : current.last_outcome === 'failed' || current.last_outcome === 'interrupted'
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
    created_at_ms: itemCreatedAt({ created_at: queued.created_at } as FlowerRuntimeCurrentItem, base.updated_at_ms),
    ...(queued.input?.attachments?.length ? {
      attachments: queued.input.attachments.map((attachment, index) => ({
        attachment_id: trim(attachment.attachment_id) || `queued:${trim(queued.id)}:${index}`,
        name: trim(attachment.name),
        mime_type: trim(attachment.mime_type),
        size_bytes: Math.max(0, Math.floor(Number(attachment.size_bytes) || 0)),
        ...(safeFlowerAttachmentURL(attachment.url) ? { url: safeFlowerAttachmentURL(attachment.url)! } : {}),
      })).filter((attachment) => attachment.name && attachment.mime_type),
    } : {}),
  }));
  const activeRunID = status === 'running' || status === 'waiting_approval' || status === 'waiting_user'
    ? trim(current.run_id)
    : '';
  if ((status === 'running' || status === 'waiting_approval' || status === 'waiting_user') && !activeRunID) {
    throw new Error('Flower contract error: an active thread current requires run_id.');
  }
  const projected: FlowerThreadSnapshot = {
    ...base,
    updated_at_ms: base.updated_at_ms,
    status,
    active_run_id: activeRunID || undefined,
    run_progress: runtimeRunProgress(current),
    approval_pending: approvalCount > 0,
    approval_pending_count: approvalCount,
    approval_actions: approvalActions,
    input_request: inputRequest,
    queued_turn_count: queuedTurns.length,
    queued_turns: queuedTurns,
    messages,
    error: trim(current.error)
      ? { code: trim(current.run_error_code) || 'floret_turn_failed', message: trim(current.error) }
      : undefined,
  };
  return { ...projected, title: canonicalFlowerThreadSnapshotTitle(projected) };
}

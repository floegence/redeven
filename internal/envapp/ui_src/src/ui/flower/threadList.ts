import type { ThreadView } from '../pages/AIChatContext';
import {
  createFlowerAction,
  type FlowerAccessState,
  type FlowerHostKind,
  type FlowerThreadKind,
  type FlowerThreadListItem,
} from './contracts';

export type FlowerThreadListProjectionOptions = Readonly<{
  currentEnvPublicId?: string;
  hostId?: string;
  hostKind?: FlowerHostKind;
  hostAvailable?: boolean;
  archivedThreadIds?: readonly string[];
}>;

function archivedThreadSet(ids: readonly string[] | undefined): Set<string> {
  return new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean));
}

function threadKind(thread: ThreadView, archived: Set<string>): FlowerThreadKind {
  const threadId = String(thread.thread_id ?? '').trim();
  if (archived.has(threadId)) return 'archived';
  if (String(thread.working_dir ?? '').trim()) return 'task';
  return 'chat';
}

function accessState(kind: FlowerThreadKind, hostAvailable: boolean): FlowerAccessState {
  if (kind === 'archived') return 'archived';
  return hostAvailable ? 'available_here' : 'read_only';
}

export function projectFlowerThreadListItem(
  thread: ThreadView,
  options: FlowerThreadListProjectionOptions = {},
): FlowerThreadListItem {
  const archived = archivedThreadSet(options.archivedThreadIds);
  const kind = threadKind(thread, archived);
  const hostAvailable = options.hostAvailable !== false;
  const state = accessState(kind, hostAvailable);
  const readOnlyReason = state === 'read_only' ? 'Flower Host offline' : undefined;
  const currentEnvLabel = kind === 'task' ? String(options.currentEnvPublicId ?? '').trim() : '';
  const primaryAction = createFlowerAction({
    kind: state === 'read_only' ? 'view_thread' : 'open_thread',
    label: state === 'read_only' ? 'View' : 'Open',
    enabled: true,
    presentationHint: 'thread_row',
  });
  const secondaryActions = state === 'read_only'
    ? [
        createFlowerAction({
          kind: 'continue_here',
          label: 'Continue here',
          enabled: true,
          presentationHint: 'thread_row',
        }),
      ]
    : [];

  return {
    thread_id: String(thread.thread_id ?? '').trim(),
    title: String(thread.title ?? '').trim() || 'Untitled chat',
    kind,
    home_host_id: String(options.hostId ?? 'env:current').trim(),
    home_host_kind: options.hostKind ?? 'env_local',
    access_state: state,
    read_only_reason: readOnlyReason,
    summary: String(thread.working_dir ?? '').trim() || undefined,
    source_label: currentEnvLabel ? `Current env: ${currentEnvLabel}` : undefined,
    target_labels: currentEnvLabel ? [currentEnvLabel] : [],
    last_message_preview: String(thread.last_message_preview ?? '').trim() || undefined,
    last_activity_at_unix_ms: Number(thread.last_message_at_unix_ms || thread.updated_at_unix_ms || thread.created_at_unix_ms || 0),
    primary_action: primaryAction,
    secondary_actions: secondaryActions,
  };
}

export function filterFlowerThreadListItems(
  items: readonly FlowerThreadListItem[],
  filter: 'all' | 'chat' | 'task' | 'current_env' | 'other_host',
  currentEnvPublicId?: string,
): FlowerThreadListItem[] {
  const currentEnv = String(currentEnvPublicId ?? '').trim();
  return items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'chat') return item.kind === 'chat';
    if (filter === 'task') return item.kind === 'task';
    if (filter === 'current_env') {
      return !!currentEnv && item.target_labels.includes(currentEnv);
    }
    return item.access_state === 'on_another_host' || item.access_state === 'available_on_flower_host';
  });
}

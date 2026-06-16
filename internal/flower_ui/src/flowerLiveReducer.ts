import type {
  FlowerApprovalAction,
  FlowerChatMessage,
  FlowerThreadLiveSnapshot,
  FlowerThreadLiveUpdate,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { flowerMessageSignature } from './flowerTimelineProjection';

function mergeMessages(messages: readonly FlowerChatMessage[], message: FlowerChatMessage | null | undefined): readonly FlowerChatMessage[] {
  if (!message) return messages;
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  if (flowerMessageSignature(messages[index]) === flowerMessageSignature(message)) return messages;
  const next = messages.slice();
  next[index] = message;
  return next;
}

function removeMessage(messages: readonly FlowerChatMessage[], messageID: string): readonly FlowerChatMessage[] {
  if (!messageID) return messages;
  const next = messages.filter((message) => message.id !== messageID);
  return next.length === messages.length ? messages : next;
}

function pendingApprovalActions(actions: readonly FlowerApprovalAction[] | undefined): readonly FlowerApprovalAction[] {
  return (actions ?? []).filter((action) => action.status === 'pending' && action.state === 'requested');
}

function mergeThreadPatch(current: FlowerThreadSnapshot, patch: FlowerThreadSnapshot): FlowerThreadSnapshot {
  return {
    ...current,
    ...patch,
    messages: patch.messages.length > 0 ? patch.messages : current.messages,
    approval_actions: patch.approval_actions ?? current.approval_actions,
    input_request: patch.input_request === undefined ? current.input_request : patch.input_request,
    error: patch.error === undefined ? current.error : patch.error,
  };
}

export function projectFlowerLiveSnapshot(snapshot: FlowerThreadLiveSnapshot): FlowerThreadSnapshot {
  const activeRun = snapshot.active_run ?? null;
  let thread: FlowerThreadSnapshot = {
    ...snapshot.thread,
    ...(snapshot.read_status ? { read_status: snapshot.read_status } : {}),
    approval_actions: pendingApprovalActions(activeRun?.approval_actions ?? snapshot.thread.approval_actions),
  };
  if (activeRun?.input_request !== undefined) {
    thread = { ...thread, input_request: activeRun.input_request };
  }
  if (activeRun?.message) {
    thread = {
      ...thread,
      status: activeRun.status,
      messages: mergeMessages(thread.messages, activeRun.message),
    };
  }
  return thread;
}

export type FlowerLiveUpdateResult = Readonly<{
  thread: FlowerThreadSnapshot;
  cursor: number;
  resyncRequired: boolean;
}>;

function currentActiveRunMessageID(thread: FlowerThreadSnapshot): string {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === 'assistant' && message.status === 'streaming') {
      return message.id;
    }
  }
  return '';
}

export function applyFlowerLiveUpdate(
  current: FlowerThreadSnapshot,
  cursor: number,
  update: FlowerThreadLiveUpdate,
): FlowerLiveUpdateResult {
  if (update.kind === 'resync.required') {
    return { thread: current, cursor: Math.max(cursor, update.seq), resyncRequired: true };
  }
  let next = current;
  if (update.thread) {
    next = mergeThreadPatch(next, update.thread);
  }
  if (update.read_status) {
    next = { ...next, read_status: update.read_status };
  }
  if (update.message) {
    next = { ...next, messages: mergeMessages(next.messages, update.message) };
  }
  if (update.clear_active_run) {
    const activeMessageID = update.active_run?.message?.id ?? currentActiveRunMessageID(next);
    if (activeMessageID) {
      next = { ...next, messages: removeMessage(next.messages, activeMessageID) };
    }
    next = { ...next, approval_actions: [] };
  }
  if (update.active_run) {
    next = {
      ...next,
      status: update.active_run.status,
      approval_actions: pendingApprovalActions(update.active_run.approval_actions),
      ...(update.active_run.input_request !== undefined ? { input_request: update.active_run.input_request } : {}),
      messages: mergeMessages(next.messages, update.active_run.message),
    };
  }
  return { thread: next, cursor: Math.max(cursor, update.seq), resyncRequired: false };
}

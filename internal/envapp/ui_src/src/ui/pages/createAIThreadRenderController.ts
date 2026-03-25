import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from 'solid-js';

import { upsertMessageById } from '../chat/messageState';
import type { Message, StreamEvent } from '../chat/types';
import type { SubagentView } from './aiDataNormalizers';
import {
  applyStreamEventBatchToLiveRunMessage,
  clearLiveRunMessageIfTranscriptCaughtUp,
  mergeLiveRunSnapshot,
  resolveRenderableLiveRunMessage,
} from './flowerLiveRunState';
import { projectThreadTranscriptMessages } from './aiThreadRenderProjection';
import { deriveSubagentViewsFromMessages } from './aiSubagentState';

export interface CreateAIThreadRenderControllerArgs {
  previousRenderedMessages: Accessor<Message[]>;
  scheduleAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}

export interface AIThreadRenderController {
  transcriptMessages: Accessor<Message[]>;
  liveRunMessage: Accessor<Message | null>;
  projectedMessages: Accessor<Message[]>;
  threadSubagentsById: Accessor<Record<string, SubagentView>>;
  activeThreadSubagents: Accessor<SubagentView[]>;
  liveAssistantTailMessage: Accessor<Message | null>;
  hasStreamingAssistantMessage: Accessor<boolean>;
  reset: () => void;
  replaceTranscriptMessages: (messages: Message[]) => void;
  mergeTranscriptMessages: (messages: Message[]) => void;
  upsertTranscriptMessage: (message: Message) => void;
  applyLiveRunSnapshot: (message: Message) => void;
  applyLiveRunStreamEvent: (event: StreamEvent) => void;
}

export function createAIThreadRenderController(
  args: CreateAIThreadRenderControllerArgs,
): AIThreadRenderController {
  const [transcriptMessages, setTranscriptMessages] = createSignal<Message[]>([]);
  const [liveRunMessage, setLiveRunMessage] = createSignal<Message | null>(null);
  const threadSubagentsById = createMemo<Record<string, SubagentView>>(() => (
    deriveSubagentViewsFromMessages(transcriptMessages())
  ));

  let pendingLiveRunEvents: StreamEvent[] = [];
  let liveRunRaf: number | null = null;

  const scheduleAnimationFrame = args.scheduleAnimationFrame ?? (
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
  );
  const cancelScheduledAnimationFrame = args.cancelAnimationFrame ?? (
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null
  );

  const projectedMessages = createMemo(() => projectThreadTranscriptMessages({
    transcriptMessages: transcriptMessages(),
    previousRenderedMessages: args.previousRenderedMessages(),
    subagentById: threadSubagentsById(),
  }));
  const activeThreadSubagents = createMemo(() => (
    Object.values(threadSubagentsById()).sort((left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs)
  ));
  const liveAssistantTailMessage = createMemo(() => (
    resolveRenderableLiveRunMessage(liveRunMessage(), transcriptMessages())
  ));
  const hasStreamingAssistantMessage = createMemo(() => liveRunMessage()?.status === 'streaming');

  const cancelPendingLiveRunFlush = (): void => {
    pendingLiveRunEvents = [];
    if (liveRunRaf !== null && cancelScheduledAnimationFrame) {
      cancelScheduledAnimationFrame(liveRunRaf);
    }
    liveRunRaf = null;
  };

  const flushLiveRunStreamEvents = (): void => {
    const events = pendingLiveRunEvents;
    pendingLiveRunEvents = [];
    liveRunRaf = null;
    if (events.length === 0) return;

    const transcript = untrack(transcriptMessages);
    setLiveRunMessage((current) => (
      clearLiveRunMessageIfTranscriptCaughtUp(applyStreamEventBatchToLiveRunMessage(current, events), transcript)
    ));
  };

  createEffect(() => {
    const transcript = transcriptMessages();
    const currentLiveRunMessage = liveRunMessage();
    const nextLiveRunMessage = clearLiveRunMessageIfTranscriptCaughtUp(currentLiveRunMessage, transcript);
    if (nextLiveRunMessage !== currentLiveRunMessage) {
      setLiveRunMessage(nextLiveRunMessage);
    }
  });

  onCleanup(() => {
    cancelPendingLiveRunFlush();
  });

  const reset = (): void => {
    cancelPendingLiveRunFlush();
    setTranscriptMessages([]);
    setLiveRunMessage(null);
  };

  const replaceTranscriptMessages = (messages: Message[]): void => {
    setTranscriptMessages(messages);
  };

  const mergeTranscriptMessages = (messages: Message[]): void => {
    if (messages.length <= 0) return;
    setTranscriptMessages((current) => {
      let next = current;
      messages.forEach((message) => {
        next = upsertMessageById(next, message);
      });
      return next;
    });
  };

  const upsertTranscriptMessage = (message: Message): void => {
    setTranscriptMessages((current) => upsertMessageById(current, message));
  };

  const applyLiveRunSnapshot = (message: Message): void => {
    const transcript = untrack(transcriptMessages);
    setLiveRunMessage((current) => (
      clearLiveRunMessageIfTranscriptCaughtUp(mergeLiveRunSnapshot(current, message), transcript)
    ));
  };

  const applyLiveRunStreamEvent = (event: StreamEvent): void => {
    pendingLiveRunEvents.push(event);
    if (liveRunRaf !== null) {
      return;
    }
    if (!scheduleAnimationFrame) {
      flushLiveRunStreamEvents();
      return;
    }
    liveRunRaf = scheduleAnimationFrame(flushLiveRunStreamEvents);
  };

  return {
    transcriptMessages,
    liveRunMessage,
    projectedMessages,
    threadSubagentsById,
    activeThreadSubagents,
    liveAssistantTailMessage,
    hasStreamingAssistantMessage,
    reset,
    replaceTranscriptMessages,
    mergeTranscriptMessages,
    upsertTranscriptMessage,
    applyLiveRunSnapshot,
    applyLiveRunStreamEvent,
  };
}

import type { Message, MessageBlock } from '../chat/types';
import type { SubagentView } from './aiDataNormalizers';

type ToolCallBlock = Extract<MessageBlock, { type: 'tool-call' }>;
type ChecklistBlock = Extract<MessageBlock, { type: 'checklist' }>;

export interface ProjectThreadRenderMessagesArgs {
  transcriptMessages: Message[];
  overlayMessages: Message[];
  previousRenderedMessages: Message[];
  subagentById: Record<string, SubagentView>;
}

export function sameSubagentViewContent(left: SubagentView | null | undefined, right: SubagentView | null | undefined): boolean {
  if (!left || !right) return left === right;
  return (
    left.subagentId === right.subagentId &&
    left.taskId === right.taskId &&
    left.specId === right.specId &&
    left.title === right.title &&
    left.objective === right.objective &&
    left.contextMode === right.contextMode &&
    left.promptHash === right.promptHash &&
    left.delegationPromptMarkdown === right.delegationPromptMarkdown &&
    left.agentType === right.agentType &&
    left.triggerReason === right.triggerReason &&
    left.status === right.status &&
    left.summary === right.summary &&
    left.updatedAtUnixMs === right.updatedAtUnixMs &&
    left.error === right.error &&
    JSON.stringify(left.deliverables ?? []) === JSON.stringify(right.deliverables ?? []) &&
    JSON.stringify(left.definitionOfDone ?? []) === JSON.stringify(right.definitionOfDone ?? []) &&
    JSON.stringify(left.outputSchema ?? {}) === JSON.stringify(right.outputSchema ?? {}) &&
    JSON.stringify(left.evidenceRefs ?? []) === JSON.stringify(right.evidenceRefs ?? []) &&
    JSON.stringify(left.keyFiles ?? []) === JSON.stringify(right.keyFiles ?? []) &&
    JSON.stringify(left.openRisks ?? []) === JSON.stringify(right.openRisks ?? []) &&
    JSON.stringify(left.nextActions ?? []) === JSON.stringify(right.nextActions ?? []) &&
    JSON.stringify(left.history ?? []) === JSON.stringify(right.history ?? []) &&
    JSON.stringify(left.stats ?? {}) === JSON.stringify(right.stats ?? {})
  );
}

export function pruneConvergedOverlayMessages(transcriptMessages: Message[], overlayMessages: Message[]): Message[] {
  const transcriptIds = new Set(
    transcriptMessages
      .map((message) => String(message?.id ?? '').trim())
      .filter(Boolean),
  );
  if (transcriptIds.size === 0) {
    return overlayMessages;
  }
  let changed = false;
  const next = overlayMessages.filter((message) => {
    const keep = !transcriptIds.has(String(message?.id ?? '').trim());
    if (!keep) changed = true;
    return keep;
  });
  return changed ? next : overlayMessages;
}

export function projectThreadRenderMessages(args: ProjectThreadRenderMessagesArgs): Message[] {
  const transcriptOrder: string[] = [];
  const transcriptById = new Map<string, Message>();
  for (const message of args.transcriptMessages) {
    const id = String(message?.id ?? '').trim();
    if (!id || transcriptById.has(id)) continue;
    transcriptOrder.push(id);
    transcriptById.set(id, message);
  }

  const overlayOrder: string[] = [];
  const overlayById = new Map<string, Message>();
  for (const message of args.overlayMessages) {
    const id = String(message?.id ?? '').trim();
    if (!id || overlayById.has(id)) continue;
    overlayOrder.push(id);
    overlayById.set(id, message);
  }

  const projected: Message[] = [];
  const seen = new Set<string>();

  for (const id of transcriptOrder) {
    const nextMessage = overlayById.get(id) ?? transcriptById.get(id);
    if (!nextMessage) continue;
    projected.push(nextMessage);
    seen.add(id);
  }

  for (const previous of args.previousRenderedMessages) {
    const id = String(previous?.id ?? '').trim();
    if (!id || seen.has(id)) continue;

    const overlayMessage = overlayById.get(id);
    if (overlayMessage) {
      projected.push(overlayMessage);
      seen.add(id);
      continue;
    }

    if (shouldCarryForwardLocalOnlyMessage(previous)) {
      projected.push(previous);
      seen.add(id);
    }
  }

  for (const id of overlayOrder) {
    if (seen.has(id)) continue;
    const message = overlayById.get(id);
    if (!message) continue;
    projected.push(message);
    seen.add(id);
  }

  const withSubagentSync = syncSubagentBlocksWithLatest(projected, args.subagentById);
  return carryForwardTransientMessageState(args.previousRenderedMessages, withSubagentSync);
}

export function syncSubagentBlocksWithLatest(inputMessages: Message[], latestById: Record<string, SubagentView>): Message[] {
  let changed = false;

  const patchBlocks = (blocks: MessageBlock[]): MessageBlock[] => {
    let blockChanged = false;
    const nextBlocks = blocks.map((block) => {
      let nextBlock = block;

      if (block.type === 'subagent') {
        const latest = latestById[block.subagentId];
        if (latest) {
          const latestStatus = latest.status;
          const same = sameSubagentViewContent(
            {
              subagentId: block.subagentId,
              taskId: block.taskId,
              specId: block.specId,
              title: block.title,
              objective: block.objective,
              contextMode: block.contextMode,
              promptHash: block.promptHash,
              delegationPromptMarkdown: block.delegationPromptMarkdown,
              deliverables: block.deliverables ?? [],
              definitionOfDone: block.definitionOfDone ?? [],
              outputSchema: block.outputSchema ?? {},
              agentType: block.agentType,
              triggerReason: block.triggerReason,
              status: block.status,
              summary: block.summary,
              evidenceRefs: block.evidenceRefs,
              keyFiles: block.keyFiles,
              openRisks: block.openRisks,
              nextActions: block.nextActions,
              history: block.history,
              stats: block.stats,
              updatedAtUnixMs: block.updatedAtUnixMs,
              error: block.error,
            },
            {
              ...latest,
              status: latestStatus,
            },
          );

          if (!same) {
            nextBlock = {
              ...block,
              subagentId: latest.subagentId,
              taskId: latest.taskId,
              specId: latest.specId,
              title: latest.title,
              objective: latest.objective,
              contextMode: latest.contextMode,
              promptHash: latest.promptHash,
              delegationPromptMarkdown: latest.delegationPromptMarkdown,
              deliverables: latest.deliverables ?? [],
              definitionOfDone: latest.definitionOfDone ?? [],
              outputSchema: latest.outputSchema ?? {},
              agentType: latest.agentType,
              triggerReason: latest.triggerReason,
              status: latestStatus,
              summary: latest.summary,
              evidenceRefs: latest.evidenceRefs,
              keyFiles: latest.keyFiles,
              openRisks: latest.openRisks,
              nextActions: latest.nextActions,
              history: latest.history,
              stats: latest.stats,
              updatedAtUnixMs: latest.updatedAtUnixMs,
              error: latest.error,
            };
            blockChanged = true;
          }
        }
      }

      if (nextBlock.type === 'tool-call' && Array.isArray(nextBlock.children) && nextBlock.children.length > 0) {
        const patchedChildren = patchBlocks(nextBlock.children);
        if (patchedChildren !== nextBlock.children) {
          nextBlock = {
            ...nextBlock,
            children: patchedChildren,
          };
          blockChanged = true;
        }
      }

      return nextBlock;
    });

    if (!blockChanged) {
      return blocks;
    }
    changed = true;
    return nextBlocks;
  };

  const nextMessages = inputMessages.map((message) => {
    const patchedBlocks = patchBlocks(message.blocks);
    if (patchedBlocks === message.blocks) {
      return message;
    }
    return {
      ...message,
      blocks: patchedBlocks,
    };
  });

  return changed ? nextMessages : inputMessages;
}

export function carryForwardTransientMessageState(previousRenderedMessages: Message[], nextMessages: Message[]): Message[] {
  if (previousRenderedMessages.length === 0 || nextMessages.length === 0) {
    return nextMessages;
  }

  const previousById = new Map<string, Message>();
  previousRenderedMessages.forEach((message) => {
    const id = String(message?.id ?? '').trim();
    if (!id || previousById.has(id)) return;
    previousById.set(id, message);
  });

  let changed = false;
  const carried = nextMessages.map((message) => {
    const previous = previousById.get(String(message?.id ?? '').trim());
    if (!previous) return message;
    const mergedBlocks = carryForwardBlocks(previous.blocks, message.blocks);
    if (mergedBlocks === message.blocks) {
      return message;
    }
    changed = true;
    return {
      ...message,
      blocks: mergedBlocks,
    };
  });

  return changed ? carried : nextMessages;
}

function shouldCarryForwardLocalOnlyMessage(message: Message): boolean {
  return message.role === 'user' || message.role === 'system';
}

function carryForwardBlocks(previousBlocks: MessageBlock[], nextBlocks: MessageBlock[]): MessageBlock[] {
  let changed = false;

  const merged = nextBlocks.map((nextBlock, index) => {
    const previousBlock = findMatchingPreviousBlock(previousBlocks, nextBlock, index);
    if (!previousBlock) return nextBlock;

    if (nextBlock.type === 'tool-call' && previousBlock.type === 'tool-call') {
      const carriedToolState = carryForwardToolCallState(previousBlock, nextBlock);
      if (carriedToolState !== nextBlock) {
        changed = true;
      }
      return carriedToolState;
    }

    if (nextBlock.type === 'checklist' && previousBlock.type === 'checklist') {
      const carriedChecklistState = carryForwardChecklistState(previousBlock, nextBlock);
      if (carriedChecklistState !== nextBlock) {
        changed = true;
      }
      return carriedChecklistState;
    }

    return nextBlock;
  });

  return changed ? merged : nextBlocks;
}

function findMatchingPreviousBlock(previousBlocks: MessageBlock[], nextBlock: MessageBlock, index: number): MessageBlock | null {
  if (nextBlock.type === 'tool-call') {
    const toolId = String(nextBlock.toolId ?? '').trim();
    if (toolId) {
      const match = previousBlocks.find(
        (block) => block.type === 'tool-call' && String(block.toolId ?? '').trim() === toolId,
      );
      if (match) return match;
    }
  }

  const candidate = previousBlocks[index];
  if (!candidate) return null;
  return candidate.type === nextBlock.type ? candidate : null;
}

function carryForwardToolCallState(previous: ToolCallBlock, next: ToolCallBlock): ToolCallBlock {
  let changed = false;
  let carried: ToolCallBlock = next;

  if (previous.collapsed !== undefined && previous.collapsed !== next.collapsed) {
    carried = {
      ...carried,
      collapsed: previous.collapsed,
    };
    changed = true;
  }

  if (previous.requiresApproval === true && next.requiresApproval === true && previous.approvalState && previous.approvalState !== next.approvalState) {
    carried = {
      ...carried,
      approvalState: previous.approvalState,
      status:
        previous.approvalState === 'approved' && next.status === 'pending'
          ? 'running'
          : previous.approvalState === 'rejected'
          ? 'error'
          : carried.status,
      error:
        previous.approvalState === 'rejected'
          ? carried.error || previous.error || 'Rejected by user'
          : carried.error,
    };
    changed = true;
  }

  const nextChildren = Array.isArray(carried.children) ? carried.children : [];
  const previousChildren = Array.isArray(previous.children) ? previous.children : [];
  const mergedChildren = carryForwardBlocks(previousChildren, nextChildren);
  if (mergedChildren !== nextChildren) {
    carried = {
      ...carried,
      children: mergedChildren,
    };
    changed = true;
  }

  return changed ? carried : next;
}

function carryForwardChecklistState(previous: ChecklistBlock, next: ChecklistBlock): ChecklistBlock {
  const previousCheckedById = new Map(
    previous.items.map((item) => [item.id, item.checked]),
  );

  let changed = false;
  const items = next.items.map((item) => {
    const previousChecked = previousCheckedById.get(item.id);
    if (previousChecked === undefined || previousChecked === item.checked) {
      return item;
    }
    changed = true;
    return {
      ...item,
      checked: previousChecked,
    };
  });

  return changed
    ? {
        ...next,
        items,
      }
    : next;
}

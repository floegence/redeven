import type { Message, MessageBlock } from '../chat/types';
import type { SubagentView } from './aiDataNormalizers';
import { sameSubagentViewContent } from './aiSubagentState';

type ActivityTimelineBlock = Extract<MessageBlock, { type: 'activity-timeline' }>;
type ChecklistBlock = Extract<MessageBlock, { type: 'checklist' }>;

export interface ProjectThreadTranscriptMessagesArgs {
  transcriptMessages: Message[];
  previousRenderedMessages: Message[];
  subagentById: Record<string, SubagentView>;
}

export function projectThreadTranscriptMessages(args: ProjectThreadTranscriptMessagesArgs): Message[] {
  const projected = args.transcriptMessages.slice();
  const seen = new Set(
    projected
      .map((message) => String(message?.id ?? '').trim())
      .filter(Boolean),
  );

  for (const previous of args.previousRenderedMessages) {
    const id = String(previous?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    if (!shouldCarryForwardLocalOnlyMessage(previous)) continue;
    projected.push(previous);
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

    const nextRenderKey = carryForwardRenderKey(previous, message);
    const mergedBlocks = carryForwardBlocks(previous.blocks, message.blocks);
    const renderKeyChanged = nextRenderKey !== String(message.renderKey ?? '').trim();
    if (mergedBlocks === message.blocks && !renderKeyChanged) {
      return message;
    }

    changed = true;
    return {
      ...message,
      renderKey: nextRenderKey || undefined,
      blocks: mergedBlocks,
    };
  });

  return changed ? carried : nextMessages;
}

function shouldCarryForwardLocalOnlyMessage(message: Message): boolean {
  return message.role === 'user' || message.role === 'system';
}

function carryForwardRenderKey(previous: Message, next: Message): string {
  const previousRenderKey = String(previous.renderKey ?? '').trim();
  if (previousRenderKey) {
    return previousRenderKey;
  }
  return String(next.renderKey ?? '').trim();
}

function carryForwardBlocks(previousBlocks: MessageBlock[], nextBlocks: MessageBlock[]): MessageBlock[] {
  let changed = false;

  const merged = nextBlocks.map((nextBlock, index) => {
    const previousBlock = findMatchingPreviousBlock(previousBlocks, nextBlock, index);
    if (!previousBlock) return nextBlock;

    if (nextBlock.type === 'activity-timeline' && previousBlock.type === 'activity-timeline') {
      const carriedActivityState = carryForwardActivityTimelineState(previousBlock, nextBlock);
      if (carriedActivityState !== nextBlock) {
        changed = true;
      }
      return carriedActivityState;
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
  if (nextBlock.type === 'activity-timeline') {
    const runId = String(nextBlock.runId ?? '').trim();
    if (runId) {
      const match = previousBlocks.find(
        (block) => block.type === 'activity-timeline' && String(block.runId ?? '').trim() === runId,
      );
      if (match) return match;
    }
  }

  const candidate = previousBlocks[index];
  if (!candidate) return null;
  return candidate.type === nextBlock.type ? candidate : null;
}

function carryForwardActivityTimelineState(previous: ActivityTimelineBlock, next: ActivityTimelineBlock): ActivityTimelineBlock {
  const previousByToolId = new Map<string, {
    approvalState?: string;
    status?: string;
    severity?: string;
  }>();
  for (const group of previous.groups) {
    for (const item of group.items) {
      const toolId = String(item.toolId ?? '').trim();
      if (!toolId || item.requiresApproval !== true) continue;
      previousByToolId.set(toolId, {
        approvalState: item.approvalState,
        status: item.status,
        severity: item.severity,
      });
    }
  }
  if (previousByToolId.size === 0) {
    return next;
  }

  let changed = false;
  const groups = next.groups.map((group) => {
    let groupChanged = false;
    const items = group.items.map((item) => {
      const toolId = String(item.toolId ?? '').trim();
      const previousItem = toolId ? previousByToolId.get(toolId) : undefined;
      if (
        !previousItem ||
        item.requiresApproval !== true ||
        !previousItem.approvalState ||
        previousItem.approvalState === item.approvalState
      ) {
        return item;
      }
      groupChanged = true;
      changed = true;
      return {
        ...item,
        approvalState: previousItem.approvalState,
        status: previousItem.status === 'error' || previousItem.approvalState === 'rejected'
          ? 'error'
          : previousItem.approvalState === 'approved' && item.status === 'pending'
            ? 'running'
            : item.status,
        severity: previousItem.approvalState === 'rejected' ? 'error' : item.severity,
      };
    });
    return groupChanged ? { ...group, items } : group;
  });

  return changed ? { ...next, groups } : next;
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

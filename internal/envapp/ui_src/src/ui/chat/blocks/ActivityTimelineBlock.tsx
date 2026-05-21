import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { fetchGatewayJSON } from '../../services/gatewayApi';
import { writeTextToClipboard } from '../../utils/clipboard';
import {
  getSelectedAskUserChoice,
  normalizeAskUserDraft,
  normalizeAskUserDraftForQuestion,
  normalizeAskUserQuestions,
  questionHasDraftAnswer,
  questionInputPlaceholder,
  questionRequiresText,
  questionSupportsAutoSubmit,
  questionUsesDirectWriteInput,
  type AskUserDraft,
  type AskUserQuestion,
} from '../askUserContract';
import { useChatContext } from '../ChatProvider';
import type {
  ActivityDetailRef,
  ActivityGroup,
  ActivityItem,
  ActivityTimelineBlock as ActivityTimelineBlockType,
} from '../types';
import { ActivityStatusIcon, formatActivityDuration, type ActivityStatus } from '../status/ActivityLine';
import { useAIChatContext } from '../../pages/AIChatContext';

export interface ActivityTimelineBlockProps {
  block: ActivityTimelineBlockType;
  messageId: string;
  blockIndex: number;
  class?: string;
}

type SelectedDetail = {
  item: ActivityItem;
  ref: ActivityDetailRef;
};

function toActivityStatus(status: string | undefined): ActivityStatus {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'pending':
    case 'waiting':
    case 'waiting_approval':
      return 'pending';
    default:
      return 'info';
  }
}

function isBlockingItem(item: ActivityItem): boolean {
  return (item.requiresApproval === true && item.approvalState === 'required')
    || item.status === 'waiting'
    || item.status === 'waiting_approval'
    || item.severity === 'blocking';
}

function itemKey(item: ActivityItem, index: number): string {
  return String(item.itemId || item.toolId || index).trim() || String(index);
}

function groupKey(group: ActivityGroup, index: number): string {
  return String(group.groupId || index).trim() || String(index);
}

function formatDetailPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function terminalDetailText(payload: any): string {
  const sections: string[] = [];
  const stdout = String(payload?.stdout ?? '');
  const stderr = String(payload?.stderr ?? '');
  const raw = String(payload?.raw_result ?? '');
  if (stdout) sections.push(`stdout\n${stdout}`);
  if (stderr) sections.push(`stderr\n${stderr}`);
  if (!stdout && !stderr && raw) sections.push(raw);
  if (sections.length === 0) return formatDetailPayload(payload);
  return sections.join('\n\n');
}

function targetLabel(item: ActivityItem): string {
  const first = Array.isArray(item.targetRefs) ? item.targetRefs[0] : undefined;
  return String(first?.label ?? item.description ?? '').trim();
}

const ActivityChipList: Component<{ chips?: ActivityItem['chips'] }> = (props) => (
  <Show when={Array.isArray(props.chips) && props.chips.length > 0}>
    <span class="chat-activity-timeline-chips">
      <For each={props.chips}>
        {(chip) => (
          <span class={cn('chat-activity-timeline-chip', chip.tone && `chat-activity-timeline-chip-${chip.tone}`)}>
            {chip.label}
            <Show when={chip.value}>
              {(value) => <span class="chat-activity-timeline-chip-value">{value()}</span>}
            </Show>
          </span>
        )}
      </For>
    </span>
  </Show>
);

const ActivityApprovalActions: Component<{ messageId: string; item: ActivityItem }> = (props) => {
  const ctx = useChatContext();
  const canApprove = createMemo(() => props.item.requiresApproval === true && props.item.approvalState === 'required');

  return (
    <Show when={canApprove()}>
      <span class="chat-activity-approval-actions">
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-approve"
          onClick={() => ctx.approveToolCall(props.messageId, String(props.item.toolId ?? ''), true)}
        >
          Allow
        </button>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-reject"
          onClick={() => ctx.approveToolCall(props.messageId, String(props.item.toolId ?? ''), false)}
        >
          Deny
        </button>
      </span>
    </Show>
  );
};

const ActivityAskUserItem: Component<{ messageId: string; item: ActivityItem }> = (props) => {
  const ai = useAIChatContext();
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal('');
  const activeThreadId = createMemo(() => String(ai.activeThreadId() ?? '').trim());
  const waitingPrompt = createMemo(() => ai.activeThreadWaitingPrompt());
  const waitingPromptId = createMemo(() => String(waitingPrompt()?.promptId ?? '').trim());
  const payloadQuestions = createMemo(() => normalizeAskUserQuestions(props.item.payload?.questions));
  const interactiveAllowed = createMemo(() => {
    const prompt = waitingPrompt();
    if (!prompt) return false;
    return String(prompt.messageId ?? '').trim() === props.messageId
      && String(prompt.toolId ?? '').trim() === String(props.item.toolId ?? '').trim();
  });
  const questions = createMemo(() => {
    const prompt = waitingPrompt();
    if (interactiveAllowed() && Array.isArray(prompt?.questions) && prompt.questions.length > 0) {
      return prompt.questions;
    }
    return payloadQuestions();
  });
  const promptDrafts = createMemo(() => {
    const tid = activeThreadId();
    const promptId = waitingPromptId();
    return tid && promptId ? ai.getStructuredPromptDrafts(tid, promptId) : {};
  });
  const controlsDisabled = createMemo(() => submitting() || !interactiveAllowed());
  const waitingUnavailable = createMemo(() => (props.item.status === 'waiting' || props.item.status === 'waiting_approval') && !interactiveAllowed());
  const unansweredQuestions = createMemo(() => questions().filter((question) => !questionHasDraftAnswer(question, promptDrafts()[question.id])));
  const canSubmit = createMemo(() => interactiveAllowed() && unansweredQuestions().length === 0 && !submitting());

  const setQuestionDraft = (questionId: string, next: AskUserDraft) => {
    const tid = activeThreadId();
    const promptId = waitingPromptId();
    if (!tid || !promptId) return;
    setSubmitError('');
    ai.setStructuredPromptDraft(tid, promptId, questionId, normalizeAskUserDraft(next));
  };

  const submit = async () => {
    if (!canSubmit()) return;
    const tid = activeThreadId();
    const promptId = waitingPromptId();
    if (!tid || !promptId) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await ai.submitStructuredPromptResponse({ threadId: tid, promptId, answers: promptDrafts() });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  };

  return (
    <div class={cn('chat-activity-input-request', !interactiveAllowed() && 'chat-activity-input-request-resolved')}>
      <For each={questions()}>
        {(question: AskUserQuestion) => {
          const draft = createMemo(() => normalizeAskUserDraftForQuestion(question, promptDrafts()[question.id]));
          const selectedChoice = createMemo(() => getSelectedAskUserChoice(question, draft()));
          const writeSelected = createMemo(() => question.responseMode === 'write' || (!!draft().writeSelected && !draft().choiceId));
          const showChoiceList = createMemo(() => !questionUsesDirectWriteInput(question) && question.choices.length > 0);
          const showTextInput = createMemo(() => questionRequiresText(question, draft()));
          const autoSubmit = createMemo(() => questionSupportsAutoSubmit(question, questions().length));
          const selectChoice = (choice: AskUserQuestion['choices'][number]) => {
            setQuestionDraft(question.id, { choiceId: choice.choiceId, text: draft().text, writeSelected: undefined });
            if (autoSubmit()) queueMicrotask(() => { void submit(); });
          };
          return (
            <div class="chat-activity-input-question">
              <div class="chat-activity-input-question-text">{question.question}</div>
              <Show when={showChoiceList()}>
                <div class="chat-activity-input-options" role="radiogroup" aria-label={question.header}>
                  <For each={question.choices}>
                    {(choice) => (
                      <label class={cn('chat-activity-input-option', draft().choiceId === choice.choiceId && 'chat-activity-input-option-selected')}>
                        <input
                          type="radio"
                          name={`activity-reply-${props.item.toolId}-${question.id}`}
                          checked={draft().choiceId === choice.choiceId}
                          disabled={controlsDisabled()}
                          onChange={() => selectChoice(choice)}
                        />
                        <span>
                          <span class="chat-activity-input-option-label">{choice.label}</span>
                          <Show when={choice.description}>
                            {(description) => <span class="chat-activity-input-option-description">{description()}</span>}
                          </Show>
                        </span>
                      </label>
                    )}
                  </For>
                  <Show when={question.responseMode === 'select_or_write'}>
                    <label class={cn('chat-activity-input-option', writeSelected() && 'chat-activity-input-option-selected')}>
                      <input
                        type="radio"
                        name={`activity-reply-${props.item.toolId}-${question.id}`}
                        checked={writeSelected()}
                        disabled={controlsDisabled()}
                        onChange={() => setQuestionDraft(question.id, { choiceId: undefined, text: draft().text, writeSelected: true })}
                      />
                      <span>
                        <span class="chat-activity-input-option-label">{question.writeLabel ?? 'None of the above'}</span>
                        <span class="chat-activity-input-option-description">Type another answer.</span>
                      </span>
                    </label>
                  </Show>
                </div>
              </Show>
              <Show when={showTextInput()}>
                <input
                  class="chat-activity-input-text"
                  type={question.isSecret ? 'password' : 'text'}
                  value={draft().text ?? ''}
                  placeholder={questionInputPlaceholder(question, draft())}
                  aria-label={selectedChoice()?.label ? `${question.header} - ${selectedChoice()!.label}` : question.header}
                  disabled={controlsDisabled()}
                  onInput={(event) => setQuestionDraft(question.id, { choiceId: undefined, text: event.currentTarget.value, writeSelected: true })}
                />
              </Show>
            </div>
          );
        }}
      </For>
      <Show
        when={interactiveAllowed()}
        fallback={<div class="chat-activity-input-resolved">{waitingUnavailable() ? 'Input unavailable' : 'Input resolved'}</div>}
      >
        <Show when={!questions().some((question) => questionSupportsAutoSubmit(question, questions().length)) || submitError()}>
          <div class="chat-activity-input-submit-row">
            <button type="button" class="chat-activity-input-submit" disabled={!canSubmit()} onClick={() => void submit()}>
              {submitError() ? 'Retry' : 'Continue'}
            </button>
            <span class={cn('chat-activity-input-hint', submitError() && 'chat-activity-input-hint-error')}>
              {submitError() || (unansweredQuestions().length > 0
                ? `Answer ${unansweredQuestions().length} more question${unansweredQuestions().length === 1 ? '' : 's'}.`
                : 'Ready to continue.')}
            </span>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export const ActivityTimelineBlock: Component<ActivityTimelineBlockProps> = (props) => {
  const [openByGroup, setOpenByGroup] = createSignal<Record<string, boolean>>({});
  const [selectedDetail, setSelectedDetail] = createSignal<SelectedDetail | null>(null);
  const [detailPayload, setDetailPayload] = createSignal<unknown>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal('');
  const [copied, setCopied] = createSignal(false);

  const hasGroups = createMemo(() => Array.isArray(props.block.groups) && props.block.groups.length > 0);
  const summaryStatus = createMemo(() => toActivityStatus(props.block.summary?.status));
  const durationLabel = createMemo(() => formatActivityDuration(props.block.summary?.durationMs));

  const isOpen = (group: ActivityGroup, index: number) => {
    const key = groupKey(group, index);
    const local = openByGroup()[key];
    return typeof local === 'boolean' ? local : Boolean(group.defaultOpen);
  };
  const toggleGroup = (group: ActivityGroup, index: number) => {
    const key = groupKey(group, index);
    setOpenByGroup((prev) => ({ ...prev, [key]: !isOpen(group, index) }));
  };
  const openDetail = async (item: ActivityItem, ref: ActivityDetailRef) => {
    setSelectedDetail({ item, ref });
    setDetailPayload(null);
    setDetailError('');
    setCopied(false);
    if (ref.fetchMode !== 'endpoint' || !ref.endpoint) return;
    setDetailLoading(true);
    try {
      const payload = await fetchGatewayJSON<unknown>(ref.endpoint, { method: 'GET' });
      setDetailPayload(payload);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };
  const detailText = createMemo(() => {
    const detail = selectedDetail();
    const payload = detailPayload();
    if (!detail) return '';
    return detail.ref.kind === 'terminal_output' ? terminalDetailText(payload) : formatDetailPayload(payload);
  });
  const copyDetail = async () => {
    const text = detailText();
    if (!text) return;
    await writeTextToClipboard(text);
    setCopied(true);
  };

  return (
    <Show when={hasGroups()}>
      <div class={cn('chat-activity-timeline', props.class)} data-status={summaryStatus()}>
        <div class="chat-activity-timeline-summary">
          <ActivityStatusIcon status={summaryStatus()} class="chat-activity-timeline-summary-icon" />
          <span class="chat-activity-timeline-summary-text">{props.block.summary?.label || 'Activity'}</span>
          <Show when={durationLabel()}>
            {(value) => <span class="chat-activity-timeline-duration">{value()}</span>}
          </Show>
        </div>

        <div class="chat-activity-timeline-groups">
          <For each={props.block.groups}>
            {(group, groupIndex) => {
              const expanded = createMemo(() => isOpen(group, groupIndex()));
              return (
                <div class={cn('chat-activity-group', group.severity && `chat-activity-group-${group.severity}`)}>
                  <button
                    type="button"
                    class="chat-activity-group-head"
                    aria-expanded={expanded()}
                    onClick={() => toggleGroup(group, groupIndex())}
                  >
                    <span class={cn('chat-activity-group-chevron', expanded() && 'chat-activity-group-chevron-open')} aria-hidden="true">
                      <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
                    </span>
                    <ActivityStatusIcon status={toActivityStatus(group.status)} />
                    <span class="chat-activity-group-copy">
                      <span class="chat-activity-group-title">{group.title}</span>
                      <Show when={group.subtitle}>
                        {(subtitle) => <span class="chat-activity-group-subtitle">{subtitle()}</span>}
                      </Show>
                    </span>
                    <ActivityChipList chips={group.chips} />
                  </button>

                  <Show when={expanded()}>
                    <div class="chat-activity-items">
                      <For each={group.items}>
                        {(item, itemIndex) => (
                          <div class={cn('chat-activity-item', isBlockingItem(item) && 'chat-activity-item-blocking')} data-item-id={itemKey(item, itemIndex())}>
                            <ActivityStatusIcon status={toActivityStatus(item.status)} class="chat-activity-item-status" />
                            <div class="chat-activity-item-main">
                              <div class="chat-activity-item-line">
                                <span class="chat-activity-item-label">{item.label}</span>
                                <Show when={targetLabel(item)}>
                                  {(target) => <span class="chat-activity-item-target">{target()}</span>}
                                </Show>
                                <ActivityChipList chips={item.chips} />
                              </div>
                              <Show when={item.description && !targetLabel(item)}>
                                {(description) => <div class="chat-activity-item-description">{description()}</div>}
                              </Show>
                              <Show when={item.renderer === 'blocking_prompt' || item.toolName === 'ask_user'}>
                                <ActivityAskUserItem messageId={props.messageId} item={item} />
                              </Show>
                            </div>
                            <div class="chat-activity-item-actions">
                              <ActivityApprovalActions messageId={props.messageId} item={item} />
                              <Show when={Array.isArray(item.detailRefs) && item.detailRefs.length > 0}>
                                <button
                                  type="button"
                                  class="chat-activity-detail-btn"
                                  onClick={() => void openDetail(item, item.detailRefs![0])}
                                >
                                  Details
                                </button>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        <Dialog
          open={!!selectedDetail()}
          onOpenChange={(open) => {
            if (!open) setSelectedDetail(null);
          }}
          title={selectedDetail()?.ref.title ?? 'Activity detail'}
        >
          <div class="chat-activity-detail-dialog">
            <Show when={selectedDetail()}>
              {(detail) => (
                <div class="chat-activity-detail-meta">
                  <span>{detail().item.label}</span>
                  <Show when={detail().item.toolName}>
                    {(toolName) => <code>{toolName()}</code>}
                  </Show>
                </div>
              )}
            </Show>
            <div class={cn('chat-activity-detail-body', detailError() && 'chat-activity-detail-body-error')}>
              <pre>
                {detailLoading()
                  ? 'Loading detail...'
                  : detailError()
                    ? detailError()
                    : detailText() || 'No detail captured.'}
              </pre>
            </div>
            <div class="chat-activity-detail-toolbar">
              <button type="button" class="chat-activity-detail-copy" onClick={() => void copyDetail()} disabled={!detailText()}>
                {copied() ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </Dialog>
      </div>
    </Show>
  );
};

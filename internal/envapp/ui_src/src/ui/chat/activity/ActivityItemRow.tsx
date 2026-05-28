import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

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
import { ActivityStatusIcon, type ActivityStatus } from '../status/ActivityLine';
import type { ActivityItem } from '../types';
import { useAIChatContext } from '../../pages/AIChatContext';
import { useI18n } from '../../i18n';
import { ActivityDetailPanel } from './ActivityDetailPanel';
import type { ActivityDetailLoadState } from './activityDetailTypes';

export const ActivityChipList: Component<{ chips?: ActivityItem['chips'] }> = (props) => (
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

const stopLocalEvent: JSX.EventHandlerUnion<HTMLElement, Event> = (event) => {
  event.stopPropagation();
};

function localizedQuestionInputPlaceholder(
  i18n: ReturnType<typeof useI18n>,
  question: AskUserQuestion,
  draft: AskUserDraft | undefined | null,
): string {
  const fallback = questionInputPlaceholder(question, draft);
  if (fallback && fallback !== 'Type your answer') {
    return fallback;
  }
  if (question.isSecret) {
    return i18n.t('chatActivity.enterSecretValue');
  }
  return question.responseMode === 'select_or_write'
    ? i18n.t('chatActivity.typeAnotherAnswer')
    : i18n.t('chatActivity.typeYourAnswer');
}

const ActivityApprovalActions: Component<{ messageId: string; item: ActivityItem }> = (props) => {
  const ctx = useChatContext();
  const i18n = useI18n();
  const canApprove = createMemo(() => props.item.requiresApproval === true && props.item.approvalState === 'required');

  return (
    <Show when={canApprove()}>
      <span class="chat-activity-approval-actions" onClick={stopLocalEvent}>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-approve"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.toolId ?? ''), true);
          }}
        >
          {i18n.t('chatActivity.allow')}
        </button>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-reject"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.toolId ?? ''), false);
          }}
        >
          {i18n.t('chatActivity.deny')}
        </button>
      </span>
    </Show>
  );
};

const ActivityAskUserItem: Component<{ messageId: string; item: ActivityItem }> = (props) => {
  const ai = useAIChatContext();
  const i18n = useI18n();
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
    <div
      class={cn('chat-activity-input-request', !interactiveAllowed() && 'chat-activity-input-request-resolved')}
      onClick={stopLocalEvent}
      onKeyDown={stopLocalEvent}
    >
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
                      <label class={cn(
                        'chat-activity-input-option',
                        draft().choiceId === choice.choiceId && 'chat-activity-input-option-selected',
                        controlsDisabled() && 'chat-activity-input-option-disabled',
                      )}>
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
                    <label class={cn(
                      'chat-activity-input-option',
                      writeSelected() && 'chat-activity-input-option-selected',
                      controlsDisabled() && 'chat-activity-input-option-disabled',
                    )}>
                      <input
                        type="radio"
                        name={`activity-reply-${props.item.toolId}-${question.id}`}
                        checked={writeSelected()}
                        disabled={controlsDisabled()}
                        onChange={() => setQuestionDraft(question.id, { choiceId: undefined, text: draft().text, writeSelected: true })}
                      />
                      <span>
                        <span class="chat-activity-input-option-label">{question.writeLabel ?? i18n.t('chatActivity.noneOfTheAbove')}</span>
                        <span class="chat-activity-input-option-description">{i18n.t('chatActivity.typeAnotherAnswer')}</span>
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
                  placeholder={localizedQuestionInputPlaceholder(i18n, question, draft())}
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
        fallback={<div class="chat-activity-input-resolved">{waitingUnavailable() ? i18n.t('chatActivity.inputUnavailable') : i18n.t('chatActivity.inputResolved')}</div>}
      >
        <Show when={!questions().some((question) => questionSupportsAutoSubmit(question, questions().length)) || submitError()}>
          <div class="chat-activity-input-submit-row">
            <button type="button" class="chat-activity-input-submit" disabled={!canSubmit()} onClick={() => void submit()}>
              {submitError() ? i18n.t('common.actions.retry') : i18n.t('chatActivity.continue')}
            </button>
            <span class={cn('chat-activity-input-hint', submitError() && 'chat-activity-input-hint-error')}>
              {submitError() || (unansweredQuestions().length > 0
                ? i18n.tn('chatActivity.answerMoreQuestions', unansweredQuestions().length)
                : i18n.t('chatActivity.readyToContinue'))}
            </span>
          </div>
        </Show>
      </Show>
    </div>
  );
};

function hasTextSelection(): boolean {
  const selection = window.getSelection?.();
  return Boolean(selection && selection.toString().trim());
}

export const ActivityItemRow: Component<{
  item: ActivityItem;
  itemId: string;
  panelId: string;
  status: ActivityStatus;
  targetLabel: string;
  blocking: boolean;
  messageId: string;
  expanded: boolean;
  detailState: ActivityDetailLoadState;
  onToggle: () => void;
  onRetry: () => void;
}> = (props) => {
  const hasDetail = createMemo(() => Array.isArray(props.item.detailRefs) && props.item.detailRefs.length > 0);
  const toggleFromRow = () => {
    if (!hasDetail() || hasTextSelection()) return;
    props.onToggle();
  };
  const onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (!hasDetail()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onToggle();
  };

  return (
    <div
      class={cn('chat-activity-item-shell', props.expanded && 'chat-activity-item-shell-expanded')}
      data-item-id={props.itemId}
      data-has-detail={hasDetail() ? 'true' : 'false'}
    >
      <div
        class={cn(
          'chat-activity-item',
          hasDetail() && 'chat-activity-item-clickable',
          props.blocking && 'chat-activity-item-blocking',
        )}
        role={hasDetail() ? 'button' : undefined}
        tabIndex={hasDetail() ? 0 : undefined}
        aria-expanded={hasDetail() ? props.expanded : undefined}
        aria-controls={hasDetail() ? props.panelId : undefined}
        onClick={toggleFromRow}
        onKeyDown={onKeyDown}
      >
        <Show when={hasDetail()} fallback={<span class="chat-activity-item-chevron-placeholder" aria-hidden="true" />}>
          <span class={cn('chat-activity-item-chevron', props.expanded && 'chat-activity-item-chevron-open')} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
          </span>
        </Show>
        <ActivityStatusIcon status={props.status} class="chat-activity-item-status" />
        <div class="chat-activity-item-main">
          <div class="chat-activity-item-line">
            <span class="chat-activity-item-label">{props.item.label}</span>
            <Show when={props.targetLabel}>
              {(target) => <span class="chat-activity-item-target">{target()}</span>}
            </Show>
            <ActivityChipList chips={props.item.chips} />
          </div>
          <Show when={props.item.description && !props.targetLabel}>
            {(description) => <div class="chat-activity-item-description">{description()}</div>}
          </Show>
          <Show when={props.item.renderer === 'blocking_prompt' || props.item.toolName === 'ask_user'}>
            <ActivityAskUserItem messageId={props.messageId} item={props.item} />
          </Show>
        </div>
        <div class="chat-activity-item-actions" onClick={stopLocalEvent} onKeyDown={stopLocalEvent}>
          <ActivityApprovalActions messageId={props.messageId} item={props.item} />
        </div>
      </div>
      <Show when={hasDetail() && props.expanded}>
        <ActivityDetailPanel state={props.detailState} panelId={props.panelId} onRetry={props.onRetry} />
      </Show>
    </div>
  );
};

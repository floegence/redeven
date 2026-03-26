import { For, Show, createEffect, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Activity, Folder, Send } from '@floegence/floe-webapp-core/icons';
import { Input } from '@floegence/floe-webapp-core/ui';

import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';

const COMPOSER_PRESETS = [
  {
    label: 'Review recent changes',
    prompt: 'Review the latest file changes and call out the riskiest issues first.',
  },
  {
    label: 'Inspect last failure',
    prompt: 'Inspect the latest failing command output and explain the most likely root cause.',
  },
  {
    label: 'Summarize thread',
    prompt: 'Summarize the current Codex thread and list the next concrete actions.',
  },
  {
    label: 'Plan next step',
    prompt: 'Turn the current implementation state into a short execution plan with checkpoints.',
  },
] as const;

function compactPathLabel(value: string, fallback: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized;
  if (normalized.length <= 24) return normalized;
  if (parts.length === 1) return parts[0] ?? fallback;
  return `…/${parts.slice(-2).join('/')}`;
}

export function CodexComposerShell(props: {
  activeThreadID: string | null;
  activeStatus: string;
  workspaceLabel: string;
  modelLabel: string;
  composerText: string;
  submitting: boolean;
  hostAvailable: boolean;
  onWorkspaceInput: (value: string) => void;
  onModelInput: (value: string) => void;
  onComposerInput: (value: string) => void;
  onPromptSelect: (prompt: string) => void;
  onSend: () => void;
}) {
  const [isComposing, setIsComposing] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [showOptions, setShowOptions] = createSignal(false);
  const [showPromptIdeas, setShowPromptIdeas] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let rafId: number | null = null;

  const canSend = () =>
    props.hostAvailable &&
    !!String(props.composerText ?? '').trim() &&
    !props.submitting;

  const scheduleAdjustHeight = () => {
    if (!textareaRef) return;
    if (rafId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 320)}px`;
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!textareaRef) return;
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 320)}px`;
    });
  };

  createEffect(() => {
    void props.composerText;
    scheduleAdjustHeight();
  });

  const statusNote = () => {
    if (!props.hostAvailable) {
      return 'Install `codex` on the host to enable sending from this editor.';
    }
    return '';
  };

  const workspaceValue = () => String(props.workspaceLabel ?? '').trim();
  const modelValue = () => String(props.modelLabel ?? '').trim();
  const workspaceChipLabel = () => compactPathLabel(workspaceValue(), 'Working dir');
  const modelChipLabel = () => modelValue() || 'Host default';
  const sendLabel = () => (props.activeThreadID ? 'Send to Codex' : 'Create chat and send');
  const showOptionsButton = () => !workspaceValue() && !modelValue();
  const shouldShowStatusChip = () => {
    const value = String(props.activeStatus ?? '').trim().toLowerCase();
    return value.length > 0 && value !== 'idle';
  };

  return (
    <div data-codex-surface="composer" class={cn(
      'chat-input-container codex-chat-input',
      isFocused() && 'chat-input-container-focused',
    )}>
      <div class="chat-input-body codex-chat-input-body">
        <div class="codex-chat-input-primary-row">
          <textarea
            ref={textareaRef}
            value={props.composerText}
            onInput={(event) => {
              props.onComposerInput(event.currentTarget.value);
              scheduleAdjustHeight();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={scheduleAdjustHeight}
            onCompositionEnd={() => {
              setIsComposing(false);
              scheduleAdjustHeight();
            }}
            onKeyDown={(event) => {
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              props.onSend();
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            rows={2}
            placeholder="Ask Codex to review a change, inspect a failure, summarize a diff, or plan the next step..."
            class="chat-input-textarea codex-chat-input-textarea"
          />

          <div class="codex-chat-input-send-slot">
            <button
              type="button"
              class={cn(
                'chat-input-send-btn codex-chat-input-send-btn',
                canSend() && 'chat-input-send-btn-active',
              )}
              onClick={props.onSend}
              disabled={!canSend()}
              aria-label={sendLabel()}
              title={props.submitting ? 'Sending…' : sendLabel()}
            >
              <Send class="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div class="codex-chat-input-meta">
          <div class="codex-chat-input-meta-rail" role="toolbar" aria-label="Codex input secondary actions">
            <Show when={workspaceValue()}>
              <button
                type="button"
                class="codex-chat-chip codex-chat-chip-actionable codex-chat-working-dir-chip"
                onClick={() => setShowOptions((value) => !value)}
                title={workspaceValue()}
              >
                <Folder class="h-3.5 w-3.5" />
                <span class="codex-chat-working-dir-chip-label">{workspaceChipLabel()}</span>
              </button>
            </Show>

            <Show when={modelValue()}>
              <button
                type="button"
                class="codex-chat-chip codex-chat-chip-actionable"
                onClick={() => setShowOptions((value) => !value)}
                title={modelValue()}
              >
                <Activity class="h-3.5 w-3.5" />
                <span class="truncate">{modelChipLabel()}</span>
              </button>
            </Show>

            <Show when={showOptionsButton()}>
              <button
                type="button"
                class="codex-chat-chip codex-chat-chip-actionable"
                onClick={() => setShowOptions((value) => !value)}
                aria-expanded={showOptions()}
              >
                Options
              </button>
            </Show>

            <button
              type="button"
              class="codex-chat-chip codex-chat-chip-actionable"
              onClick={() => setShowPromptIdeas((value) => !value)}
              aria-expanded={showPromptIdeas()}
            >
              Prompt ideas
            </button>

            <Show when={!props.activeThreadID}>
              <span class="codex-chat-chip">New thread</span>
            </Show>

            <Show when={shouldShowStatusChip()}>
              <span class="codex-chat-chip">
                {props.activeStatus.replaceAll('_', ' ')}
              </span>
            </Show>
          </div>

          <Show when={showPromptIdeas()}>
            <div class="codex-chat-prompt-panel">
              <div class="codex-chat-prompt-panel-header">
                Use one of these to start a focused Codex turn.
              </div>
              <div class="codex-chat-prompt-grid">
                <For each={COMPOSER_PRESETS}>
                  {(preset) => (
                    <button
                      type="button"
                      class="codex-chat-secondary-chip codex-chat-prompt-chip"
                      onClick={() => {
                        props.onPromptSelect(preset.prompt);
                        setShowPromptIdeas(false);
                      }}
                      disabled={!props.hostAvailable}
                      title={preset.prompt}
                    >
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={showOptions()}>
            <div class="codex-chat-input-options">
              <div class="codex-chat-input-options-grid">
                <label class="codex-chat-input-field">
                  <span class="codex-chat-input-field-label">Workspace</span>
                  <Input
                    value={props.workspaceLabel}
                    onInput={(event) => props.onWorkspaceInput(event.currentTarget.value)}
                    placeholder="Absolute workspace path"
                    class="w-full"
                  />
                </label>
                <label class="codex-chat-input-field">
                  <span class="codex-chat-input-field-label">Model</span>
                  <Input
                    value={props.modelLabel}
                    onInput={(event) => props.onModelInput(event.currentTarget.value)}
                    placeholder="Use host Codex default model"
                    class="w-full"
                  />
                </label>
              </div>
              <div class="codex-chat-input-options-note">
                Codex runs directly on the host. Keep prompts focused, then review output before applying edits.
              </div>
            </div>
          </Show>

          <Show when={statusNote()}>
            <div class={cn(
              'codex-chat-input-status',
              !props.hostAvailable && 'text-error',
            )}>
              {statusNote()}
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

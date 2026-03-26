import { For, Show, createSignal } from 'solid-js';
import { Activity, Folder, Send } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tag, Textarea } from '@floegence/floe-webapp-core/ui';

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

export function CodexComposerShell(props: {
  activeThreadID: string | null;
  activeStatus: string;
  statusFlags: readonly string[];
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
  const canSend = () =>
    props.hostAvailable &&
    !!String(props.composerText ?? '').trim() &&
    !props.submitting;

  return (
    <div data-codex-surface="composer" class="codex-composer-shell">
      <div class="codex-composer-presets">
        <For each={COMPOSER_PRESETS}>
          {(preset) => (
            <button
              type="button"
              onClick={() => props.onPromptSelect(preset.prompt)}
              class="codex-composer-preset"
            >
              {preset.label}
            </button>
          )}
        </For>
      </div>

      <div class="codex-composer-card">
        <div class="codex-composer-top">
          <div class="flex flex-wrap items-center gap-2">
            <Tag variant="neutral" tone="soft" size="sm">
              {props.activeThreadID ? 'Active review' : 'Draft review'}
            </Tag>
            <Tag variant="neutral" tone="soft" size="sm">
              {props.activeStatus ? props.activeStatus.replaceAll('_', ' ') : 'idle'}
            </Tag>
            <Tag variant={props.hostAvailable ? 'success' : 'warning'} tone="soft" size="sm">
              {props.hostAvailable ? 'Host ready' : 'Install required'}
            </Tag>
            <Show when={props.statusFlags.length > 0}>
              <Tag variant="info" tone="soft" size="sm">
                {props.statusFlags[0]?.replaceAll('_', ' ')}
              </Tag>
            </Show>
          </div>
          <div class="text-[11px] text-muted-foreground">
            {props.activeThreadID ? 'Continue the current Codex thread' : 'Create a new Codex thread on send'}
          </div>
        </div>

        <div class="codex-composer-grid">
          <div class="codex-composer-field">
            <div class="codex-composer-field-label">
              <Folder class="h-3.5 w-3.5" />
              Workspace
            </div>
            <Input
              value={props.workspaceLabel}
              onInput={(event) => props.onWorkspaceInput(event.currentTarget.value)}
              placeholder="Absolute workspace path"
              class="w-full"
            />
          </div>
          <div class="codex-composer-field">
            <div class="codex-composer-field-label">
              <Activity class="h-3.5 w-3.5" />
              Model
            </div>
            <Input
              value={props.modelLabel}
              onInput={(event) => props.onModelInput(event.currentTarget.value)}
              placeholder="Use host Codex default model"
              class="w-full"
            />
          </div>
        </div>

        <div class="codex-composer-editor">
          <Textarea
            value={props.composerText}
            onInput={(event) => props.onComposerInput(event.currentTarget.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(event) => {
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              props.onSend();
            }}
            rows={5}
            placeholder="Ask Codex to review a change, inspect a failure, summarize a diff, or plan the next step..."
            class="codex-composer-textarea"
          />
        </div>

        <div class="codex-composer-footer">
          <div class="space-y-2">
            <div class="text-xs leading-6 text-muted-foreground">
              Codex runs directly from the host machine. Keep the prompt focused, then review the generated output before applying it.
            </div>
            <div class="codex-composer-hints">
              <span class="codex-composer-hint-chip">
                Enter to send
              </span>
              <span class="codex-composer-hint-chip">
                Shift+Enter for newline
              </span>
              <Show when={!props.hostAvailable}>
                <span class="codex-composer-hint-chip">
                  Host Codex unavailable
                </span>
              </Show>
            </div>
          </div>

          <Button onClick={props.onSend} disabled={!canSend()}>
            <Send class="mr-1 h-4 w-4" />
            {props.submitting ? 'Sending...' : props.activeThreadID ? 'Send to Codex' : 'Create chat and send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

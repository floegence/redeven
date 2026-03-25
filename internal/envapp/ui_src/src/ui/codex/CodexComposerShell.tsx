import { Show } from 'solid-js';
import { Button, Input, Tag, Textarea } from '@floegence/floe-webapp-core/ui';

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
  onSend: () => void;
}) {
  const canSend = () =>
    props.hostAvailable &&
    !!String(props.composerText ?? '').trim() &&
    !props.submitting;

  return (
    <div class="rounded-[1.5rem] border border-border/70 bg-card shadow-xl shadow-black/8 backdrop-blur-xl">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <Tag variant="neutral" tone="soft" size="sm">
            {props.activeThreadID ? 'Active review' : 'Draft review'}
          </Tag>
          <Tag variant="neutral" tone="soft" size="sm">
            {props.activeStatus ? props.activeStatus.replaceAll('_', ' ') : 'idle'}
          </Tag>
          <Tag variant="neutral" tone="soft" size="sm">
            {props.hostAvailable ? 'Host runtime' : 'Install required'}
          </Tag>
        </div>
        <div class="text-[11px] text-muted-foreground">
          {props.activeThreadID ? 'Continue the current Codex thread' : 'Create a new Codex thread on send'}
        </div>
      </div>

      <div class="space-y-3 p-3">
        <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_15rem]">
          <Input
            value={props.workspaceLabel}
            onInput={(event) => props.onWorkspaceInput(event.currentTarget.value)}
            placeholder="Absolute workspace path"
            class="w-full"
          />
          <Input
            value={props.modelLabel}
            onInput={(event) => props.onModelInput(event.currentTarget.value)}
            placeholder="Use host Codex default model"
            class="w-full"
          />
        </div>

        <Textarea
          value={props.composerText}
          onInput={(event) => props.onComposerInput(event.currentTarget.value)}
          rows={5}
          placeholder="Ask Codex to review a change, inspect a failure, summarize a diff, or plan the next step..."
          class="min-h-[8rem] w-full"
        />

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-1">
              Enter to send
            </span>
            <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-1">
              Shift+Enter for newline
            </span>
            <Show when={!props.hostAvailable}>
              <span class="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
                Host Codex unavailable
              </span>
            </Show>
          </div>

          <Button onClick={props.onSend} disabled={!canSend()}>
            {props.submitting ? 'Sending...' : props.activeThreadID ? 'Send to Codex' : 'Create chat and send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

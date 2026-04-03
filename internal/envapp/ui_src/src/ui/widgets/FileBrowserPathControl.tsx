import { cn } from '@floegence/floe-webapp-core';
import { Show } from 'solid-js';
import { FileBrowserPathBreadcrumb } from './FileBrowserPathBreadcrumb';

export type FileBrowserPathControlMode = 'read' | 'edit';

export interface FileBrowserPathControlProps {
  class?: string;
  mode: FileBrowserPathControlMode;
  draft: string;
  error?: string;
  submitting?: boolean;
  inputRef?: (el: HTMLInputElement) => void;
  onDraftChange: (value: string) => void;
  onActivateEdit: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function handlePathInputKeyDown(event: KeyboardEvent, props: FileBrowserPathControlProps) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      target.select();
    }
    return;
  }

  if (event.key === 'Enter' && !props.submitting) {
    event.preventDefault();
    props.onSubmit();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    props.onCancel();
  }
}

export function FileBrowserPathControl(props: FileBrowserPathControlProps) {
  return (
    <Show
      when={props.mode === 'edit'}
      fallback={<FileBrowserPathBreadcrumb class={props.class} onCurrentPathActivate={props.onActivateEdit} />}
    >
      <input
        ref={props.inputRef}
        type="text"
        value={props.draft}
        placeholder="Go to path"
        aria-label="Go to path"
        aria-invalid={Boolean(String(props.error ?? '').trim())}
        class={cn(
          'h-full w-full min-w-0 border-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70',
          props.class,
        )}
        onInput={(event) => props.onDraftChange(event.currentTarget.value)}
        onKeyDown={(event) => handlePathInputKeyDown(event, props)}
        onBlur={() => {
          if (props.submitting) return;
          props.onCancel();
        }}
      />
    </Show>
  );
}

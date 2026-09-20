import { Show, type Component } from 'solid-js';
import { ChevronDown, FolderOpen } from '@floegence/floe-webapp-core/icons';

export const FlowerWorkingDirectoryControl: Component<{
  name: string;
  title: string;
  variant: 'browse' | 'select';
  disabled?: boolean;
  expanded?: boolean;
  onClick: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}> = (props) => {
  // Keep the identifying suffix visible when a long directory name contracts.
  const characters = () => Array.from(props.name);
  const hasSuffix = () => characters().length > 20;
  return (
    <button
      type="button"
      class={`flower-working-directory-control flower-working-directory-${props.variant}`}
      title={props.title}
      aria-label={props.title}
      aria-haspopup={props.variant === 'select' ? 'dialog' : undefined}
      aria-expanded={props.variant === 'select' ? props.expanded : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <FolderOpen class="flower-working-directory-icon" aria-hidden="true" />
      <span class="flower-working-directory-name" aria-hidden="true">
        <span class="flower-working-directory-name-start">{hasSuffix() ? characters().slice(0, -8).join('') : props.name}</span>
        <Show when={hasSuffix()}>
          <span class="flower-working-directory-name-end">{characters().slice(-8).join('')}</span>
        </Show>
      </span>
      <Show when={props.variant === 'select'}>
        <ChevronDown class="flower-working-directory-chevron" aria-hidden="true" />
      </Show>
    </button>
  );
};

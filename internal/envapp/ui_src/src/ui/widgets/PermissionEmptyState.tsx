import { Show } from 'solid-js';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';

export type PermissionEmptyStateVariant = 'page' | 'deck' | 'panel' | 'workbench';

export type PermissionEmptyStateProps = {
  title: string;
  description?: string;
  variant?: PermissionEmptyStateVariant;
};

const LockIcon = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export function PermissionEmptyState(props: PermissionEmptyStateProps) {
  const variant: PermissionEmptyStateVariant = props.variant ?? 'page';
  const pad = variant === 'deck' || variant === 'workbench' ? 'p-4' : variant === 'panel' ? 'p-5' : 'p-6';

  return (
    <Panel class="h-full overflow-hidden">
      <PanelContent class={`h-full flex flex-col items-center justify-center text-center ${pad}`}>
        <div class="w-10 h-10 rounded-full bg-muted/70 flex items-center justify-center mb-3">
          <LockIcon class="w-5 h-5 text-muted-foreground" />
        </div>
        <div class="text-sm font-semibold">{props.title}</div>
        <Show when={props.description}>
          <div class="text-xs text-muted-foreground mt-1 max-w-md">{props.description}</div>
        </Show>
      </PanelContent>
    </Panel>
  );
}

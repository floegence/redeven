import { Show } from 'solid-js';

function Banner(props: {
  title: string;
  body: string;
  tone?: 'warning' | 'neutral';
}) {
  return (
    <div
      class={`codex-status-banner ${
        props.tone === 'warning'
          ? 'codex-status-banner--warning'
          : 'codex-status-banner--neutral'
      }`}
    >
      <div class={`text-sm font-medium ${props.tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
        {props.title}
      </div>
      <div class="mt-1 text-xs leading-6 text-muted-foreground">{props.body}</div>
    </div>
  );
}

export function CodexStatusBannerStack(props: {
  statusError: string | null;
  threadError: string | null;
  streamError: string | null;
  hostAvailable: boolean;
}) {
  return (
    <>
      <Show when={props.statusError}>
        <Banner title="Status error" body={props.statusError || ''} tone="warning" />
      </Show>
      <Show when={props.threadError}>
        <Banner
          title="Thread loading"
          body={props.threadError || ''}
          tone="warning"
        />
      </Show>
      <Show when={props.streamError}>
        <Banner
          title="Live event stream"
          body={`Live event stream disconnected: ${props.streamError}`}
          tone="warning"
        />
      </Show>
      <Show when={!props.hostAvailable}>
        <Banner
          title="Host diagnostics"
          body="Redeven uses the host machine's `codex` binary directly. There is no separate in-app Codex runtime toggle to manage here."
          tone="warning"
        />
      </Show>
    </>
  );
}

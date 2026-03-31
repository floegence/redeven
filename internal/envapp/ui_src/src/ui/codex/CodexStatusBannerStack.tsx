import { HighlightBlock } from '@floegence/floe-webapp-core/ui';
import { Show } from 'solid-js';

function Banner(props: {
  title: string;
  body: string;
  variant?: 'error' | 'warning';
}) {
  return (
    <HighlightBlock variant={props.variant ?? 'error'} title={props.title}>
      <p>{props.body}</p>
    </HighlightBlock>
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
        <Banner title="Status error" body={props.statusError || ''} />
      </Show>
      <Show when={props.threadError}>
        <Banner
          title="Thread loading"
          body={props.threadError || ''}
        />
      </Show>
      <Show when={props.streamError}>
        <Banner
          title="Live event stream"
          body={`Live event stream disconnected: ${props.streamError}`}
        />
      </Show>
      <Show when={!props.hostAvailable}>
        <Banner
          title="Host diagnostics"
          body="Redeven uses the host machine's `codex` binary directly. There is no separate in-app Codex runtime toggle to manage here."
          variant="warning"
        />
      </Show>
    </>
  );
}

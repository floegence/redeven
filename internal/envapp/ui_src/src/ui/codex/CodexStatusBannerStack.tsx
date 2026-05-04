import { HighlightBlock } from '@floegence/floe-webapp-core/ui';
import { Show } from 'solid-js';

import type { CodexStreamTransportState } from './types';

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
  streamTransportState: CodexStreamTransportState;
  hostAvailable: boolean;
}) {
  const streamPhase = () => String(props.streamTransportState.phase ?? '').trim();
  const streamMessage = () => String(
    props.streamTransportState.desync_reason ??
    props.streamTransportState.last_disconnect_reason ??
    '',
  ).trim();
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
      <Show when={streamPhase() === 'reconnecting'}>
        <Banner
          title="Live event stream"
          body={streamMessage() || 'Live event stream disconnected. Reconnecting...'}
          variant="warning"
        />
      </Show>
      <Show when={streamPhase() === 'lagged'}>
        <Banner
          title="Live event stream"
          body={`Live event stream dropped ${Math.max(0, Number(props.streamTransportState.last_lagged_dropped_events ?? 0) || 0)} best-effort updates while catching up.`}
          variant="warning"
        />
      </Show>
      <Show when={streamPhase() === 'desynced'}>
        <Banner
          title="Live event stream"
          body={streamMessage() || 'Live event stream lost continuity and is reloading the thread state.'}
        />
      </Show>
      <Show when={!props.hostAvailable}>
        <Banner
          title="Host diagnostics"
          body="Redeven uses the host's `codex` binary directly. There is no separate in-app Codex runtime toggle to manage here."
          variant="warning"
        />
      </Show>
    </>
  );
}

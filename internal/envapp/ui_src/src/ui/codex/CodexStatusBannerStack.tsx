import { HighlightBlock } from '@floegence/floe-webapp-core/ui';
import { Show } from 'solid-js';

import type { CodexStatus, CodexStreamTransportState } from './types';

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
  status?: CodexStatus | null;
  hostAvailable: boolean;
}) {
  const streamPhase = () => String(props.streamTransportState.phase ?? '').trim();
  const streamMessage = () => String(
    props.streamTransportState.desync_reason ??
    props.streamTransportState.last_disconnect_reason ??
    '',
  ).trim();
  const hostDiagnostics = () => [
    ['Binary', props.status?.binary_path],
    ['Codex Home', props.status?.codex_home],
    ['Runtime', props.status?.user_agent],
    ['Platform', [props.status?.platform_family, props.status?.platform_os].filter(Boolean).join(' / ')],
    ['Last stderr', props.status?.last_stderr],
  ].map(([label, value]) => [String(label), String(value ?? '').trim()] as const)
    .filter(([, value]) => value);
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
        <HighlightBlock variant="warning" title="Host diagnostics">
          <p>Redeven uses the host's `codex` binary directly. There is no separate in-app Codex runtime toggle to manage here.</p>
          <Show when={hostDiagnostics().length > 0}>
            <dl class="mt-3 grid gap-2 text-xs">
              {hostDiagnostics().map(([label, value]) => (
                <div class="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <dt class="font-medium text-muted-foreground">{label}</dt>
                  <dd class="break-words font-mono text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </Show>
        </HighlightBlock>
      </Show>
    </>
  );
}

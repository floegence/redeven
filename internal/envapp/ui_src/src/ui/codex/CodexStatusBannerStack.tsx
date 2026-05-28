import { HighlightBlock } from '@floegence/floe-webapp-core/ui';
import { Show } from 'solid-js';

import { useI18n } from '../i18n';
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
  const i18n = useI18n();
  const streamPhase = () => String(props.streamTransportState.phase ?? '').trim();
  const streamMessage = () => String(
    props.streamTransportState.desync_reason ??
    props.streamTransportState.last_disconnect_reason ??
    '',
  ).trim();
  const hostDiagnostics = () => [
    [i18n.t('codex.statusBanner.binary'), props.status?.binary_path],
    [i18n.t('codex.statusBanner.codexHome'), props.status?.codex_home],
    [i18n.t('codex.statusBanner.runtime'), props.status?.user_agent],
    [i18n.t('codex.statusBanner.platform'), [props.status?.platform_family, props.status?.platform_os].filter(Boolean).join(' / ')],
    [i18n.t('codex.statusBanner.lastStderr'), props.status?.last_stderr],
  ].map(([label, value]) => [String(label), String(value ?? '').trim()] as const)
    .filter(([, value]) => value);
  return (
    <>
      <Show when={props.statusError}>
        <Banner title={i18n.t('codex.statusBanner.statusError')} body={props.statusError || ''} />
      </Show>
      <Show when={props.threadError}>
        <Banner
          title={i18n.t('codex.statusBanner.threadLoading')}
          body={props.threadError || ''}
        />
      </Show>
      <Show when={streamPhase() === 'reconnecting'}>
        <Banner
          title={i18n.t('codex.statusBanner.liveEventStream')}
          body={streamMessage() || i18n.t('codex.statusBanner.disconnectedReconnecting')}
          variant="warning"
        />
      </Show>
      <Show when={streamPhase() === 'lagged'}>
        <Banner
          title={i18n.t('codex.statusBanner.liveEventStream')}
          body={i18n.tn('codex.statusBanner.droppedUpdates', Math.max(0, Number(props.streamTransportState.last_lagged_dropped_events ?? 0) || 0))}
          variant="warning"
        />
      </Show>
      <Show when={streamPhase() === 'desynced'}>
        <Banner
          title={i18n.t('codex.statusBanner.liveEventStream')}
          body={streamMessage() || i18n.t('codex.statusBanner.lostContinuity')}
        />
      </Show>
      <Show when={!props.hostAvailable}>
        <HighlightBlock variant="warning" title={i18n.t('codex.statusBanner.hostDiagnostics')}>
          <p>{i18n.t('codex.statusBanner.hostDiagnosticsBody')}</p>
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

import { Match, Switch } from 'solid-js';

import './connection-recovery.css';

export type ConnectionIllustrationState = 'waiting' | 'connecting' | 'paused' | 'offline' | 'failed' | 'succeeded';

export function ConnectionRecoveryIllustration(props: Readonly<{ state: ConnectionIllustrationState }>) {
  // Inline artwork stays available when the Runtime cannot serve assets.
  // Motion describes connection work only; stopped and terminal states stay still.
  return (
    <svg
      class="connection-recovery-illustration"
      data-connection-illustration={props.state}
      viewBox="0 0 240 112"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <g class="connection-recovery-illustration__workspace">
          <rect x="22" y="34" width="46" height="34" rx="5" />
          <path d="M39 78h12m-6-10v10" opacity=".55" />
          <path d="m32 45 6 5-6 5m13 0h9" />
        </g>
        <g class="connection-recovery-illustration__runtime">
          <path d="m195 29 23 13v27l-23 13-23-13V42z" />
          <path d="m172 42 23 13 23-13m-23 13v27" opacity=".6" />
          <path d="m184 35 23 13" opacity=".3" />
          <path d="M202 64v7m5-10v7" />
        </g>
        <path d="M78 54h22m40 0h22" class="connection-recovery-illustration__route" />
        <circle cx="78" cy="54" r="2" class="connection-recovery-illustration__terminal" />
        <circle cx="162" cy="54" r="2" class="connection-recovery-illustration__terminal" />
        <Switch>
          <Match when={props.state === 'waiting'}>
            <g class="connection-recovery-illustration__accent">
              <circle class="connection-recovery-illustration__beacon" cx="120" cy="54" r="16" stroke-width="1" />
              <circle cx="120" cy="54" r="9" />
              <path d="M120 49v5l3 2" />
            </g>
          </Match>
          <Match when={props.state === 'connecting'}>
            <path d="M100 54h40" class="connection-recovery-illustration__route" stroke-dasharray="2 5" />
            <g class="connection-recovery-illustration__accent">
              <path class="connection-recovery-illustration__signal" d="M85 49h9" />
              <path class="connection-recovery-illustration__signal connection-recovery-illustration__signal--return" d="M146 59h9" />
            </g>
          </Match>
          <Match when={props.state === 'paused'}>
            <path d="M117 48v12m6-12v12" stroke-width="2" />
          </Match>
          <Match when={props.state === 'offline' || props.state === 'failed'}>
            <path d="m115 58 5-8m0 8 5-8" opacity=".65" />
          </Match>
          <Match when={props.state === 'succeeded'}>
            <path d="m113 54 5 5 10-11" class="connection-recovery-illustration__success" stroke-width="2" />
          </Match>
        </Switch>
      </g>
    </svg>
  );
}

import { Switch, Match } from 'solid-js';

export function TessivenIcon(props: { kind: string; class?: string }) {
  return (
    <svg
      class={`tessiven-icon ${props.class ?? ''}`}
      data-kind={props.kind}
      viewBox="0 0 24 24"
      fill="none"
      width="23"
      height="23"
      aria-hidden="true"
    >
      <Switch
        fallback={
          <>
            <rect
              class="glyph-main"
              fill="var(--ts-glyph, currentColor)"
              x="3"
              y="4"
              width="7"
              height="7"
              rx="1.5"
            />
            <rect
              class="glyph-accent"
              fill="var(--ts-glyph-accent, currentColor)"
              x="14"
              y="13"
              width="7"
              height="7"
              rx="1.5"
            />
            <path
              class="glyph-line"
              stroke="var(--ts-glyph-accent, currentColor)"
              stroke-width="1.3"
              d="M7 11v6h7M17 13V7h-7"
            />
          </>
        }
      >
        <Match when={props.kind === 'node'}>
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="3"
            y="3"
            width="18"
            height="7"
            rx="1.5"
          />
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="3"
            y="14"
            width="18"
            height="7"
            rx="1.5"
          />
          <path
            class="glyph-cut"
            fill="var(--ts-glyph-cut, var(--background))"
            d="M6 6h7v1H6zm0 11h7v1H6z"
          />
          <circle
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            cx="18"
            cy="6.5"
            r="1"
          />
          <circle
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            cx="18"
            cy="17.5"
            r="1"
          />
        </Match>
        <Match
          when={props.kind === 'database' || props.kind === 'object_store'}
        >
          <ellipse
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            cx="12"
            cy="6"
            rx="8"
            ry="3"
          />
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="M4 6v12c0 4 16 4 16 0V6c0 4-16 4-16 0Z"
          />
          <path
            class="glyph-line"
            stroke="var(--ts-glyph-accent, currentColor)"
            stroke-width="1.3"
            d="M4 12c0 4 16 4 16 0"
          />
        </Match>
        <Match when={props.kind === 'cache'}>
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="m2 7 10-5 10 5-10 5Z"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="m2 12 10 5 10-5-4-2-6 3-6-3Z"
          />
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="m2 17 10 5 10-5-4-2-6 3-6-3Z"
          />
        </Match>
        <Match when={props.kind === 'web'}>
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="2"
            y="3"
            width="20"
            height="18"
            rx="2"
          />
          <path
            class="glyph-cut"
            fill="var(--ts-glyph-cut, var(--background))"
            d="M4 8h16v1H4zM5 12h6v6H5z"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="M14 12h5v2h-5zm0 4h5v2h-5z"
          />
        </Match>
        <Match when={props.kind === 'worker' || props.kind === 'queue'}>
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="3"
            y="5"
            width="18"
            height="16"
            rx="2"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="M6 2h12v4H6z"
          />
          <path
            class="glyph-cut"
            fill="var(--ts-glyph-cut, var(--background))"
            d="m10 10 6 4-6 4Z"
          />
        </Match>
        <Match when={props.kind === 'domain'}>
          <circle
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            cx="12"
            cy="12"
            r="10"
          />
          <ellipse
            class="glyph-line"
            stroke="var(--ts-glyph-accent, currentColor)"
            stroke-width="1.3"
            cx="12"
            cy="12"
            rx="4"
            ry="10"
          />
          <path
            class="glyph-line"
            stroke="var(--ts-glyph-accent, currentColor)"
            stroke-width="1.3"
            d="M2 12h20M5 6h14M5 18h14"
          />
        </Match>
        <Match
          when={
            props.kind === 'cdn' ||
            props.kind === 'gateway' ||
            props.kind === 'load_balancer'
          }
        >
          <path
            class="glyph-line"
            stroke="var(--ts-glyph-accent, currentColor)"
            stroke-width="1.3"
            d="M12 5v7m0 0-7 6m7-6 7 6"
          />
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="9"
            y="1"
            width="6"
            height="6"
            rx="1"
          />
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="9"
            y="9"
            width="6"
            height="6"
            rx="1"
          />
          <rect
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            x="1"
            y="17"
            width="6"
            height="6"
            rx="1"
          />
          <rect
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            x="17"
            y="17"
            width="6"
            height="6"
            rx="1"
          />
        </Match>
        <Match when={props.kind === 'nas' || props.kind === 'filesystem'}>
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="M5 3h14l3 12v6H2v-6Z"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="M5 14h14l-2-8H7Z"
          />
          <path
            class="glyph-cut"
            fill="var(--ts-glyph-cut, var(--background))"
            d="M6 17h8v1H6z"
          />
          <circle
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            cx="18"
            cy="17.5"
            r="1"
          />
        </Match>
        <Match when={props.kind === 'api'}>
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="M3 4h7v4H7v8h3v4H3Z"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="M21 4h-7v4h3v8h-3v4h7Z"
          />
          <path
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            d="m13 8-4 8h3l4-8Z"
          />
        </Match>
        <Match when={props.kind === 'search'}>
          <circle
            class="glyph-main"
            fill="var(--ts-glyph, currentColor)"
            cx="10"
            cy="10"
            r="8"
          />
          <circle
            class="glyph-cut"
            fill="var(--ts-glyph-cut, var(--background))"
            cx="10"
            cy="10"
            r="4"
          />
          <path
            class="glyph-accent"
            fill="var(--ts-glyph-accent, currentColor)"
            d="m15 13 8 7-3 3-7-8Z"
          />
        </Match>
      </Switch>
    </svg>
  );
}

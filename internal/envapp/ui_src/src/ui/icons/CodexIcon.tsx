import { Show, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

// Source asset: extracted from the official OpenAI Codex get-started page artwork
// and normalized to reduce excess transparent padding.
import codexOfficialIcon from './assets/codex-official.png?inline';

let preferredCodexIconFailed = false;

function CodexIconFallback(props: { class?: string; style?: JSX.CSSProperties }) {
  return (
    <span
      data-codex-icon-mode="fallback"
      aria-hidden="true"
      class={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[22%] border border-current/15 bg-current/5',
        props.class,
      )}
      style={props.style}
    >
      <svg viewBox="0 0 24 24" fill="none" class="h-[72%] w-[72%]" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.25" stroke="currentColor" stroke-width="1.5" opacity="0.22" />
        <path
          d="M14.75 8A4.75 4.75 0 1 0 14.75 16"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

export function CodexIcon(props: { class?: string; style?: JSX.CSSProperties }) {
  const [showFallback, setShowFallback] = createSignal(preferredCodexIconFailed);

  return (
    <Show when={!showFallback()} fallback={<CodexIconFallback class={props.class} style={props.style} />}>
      <img
        data-codex-icon-mode="preferred"
        src={codexOfficialIcon}
        alt=""
        aria-hidden="true"
        class={cn('object-contain dark:invert', props.class)}
        style={props.style}
        onError={() => {
          preferredCodexIconFailed = true;
          setShowFallback(true);
        }}
      />
    </Show>
  );
}

export function CodexNavigationIcon(props: { class?: string }) {
  return (
    <CodexIcon
      class={props.class}
      style={{
        width: '1.5rem',
        height: '1.5rem',
      }}
    />
  );
}

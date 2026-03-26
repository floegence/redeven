import type { JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

// Source asset: extracted from the official OpenAI Codex get-started page artwork.
import codexOfficialIcon from './assets/codex-official.png';

export function CodexIcon(props: { class?: string; style?: JSX.CSSProperties }) {
  return (
    <img
      src={codexOfficialIcon}
      alt=""
      aria-hidden="true"
      class={cn('object-contain dark:invert', props.class)}
      style={props.style}
    />
  );
}

export function CodexNavigationIcon(props: { class?: string }) {
  return (
    <CodexIcon
      class={props.class}
      style={{
        width: '1.25rem',
        height: '1.25rem',
      }}
    />
  );
}

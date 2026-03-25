import { cn } from '@floegence/floe-webapp-core';

// Source asset: extracted from the official OpenAI Codex get-started page artwork.
import codexOfficialIcon from './assets/codex-official.png';

export function CodexIcon(props: { class?: string }) {
  return (
    <img
      src={codexOfficialIcon}
      alt=""
      aria-hidden="true"
      class={cn('object-contain dark:invert', props.class)}
    />
  );
}

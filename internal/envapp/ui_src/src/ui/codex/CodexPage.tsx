import { Show } from 'solid-js';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { useCodexContext } from './CodexProvider';
import { CodexChatShell } from './CodexChatShell';

export function CodexPage() {
  const codex = useCodexContext();

  return (
    <div class="relative flex h-full min-h-0 flex-col">
      <Show when={codex.statusLoading()}>
        <LoadingOverlay visible message="Loading Codex..." />
      </Show>
      <CodexChatShell />
    </div>
  );
}

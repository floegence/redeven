import { createMemo } from 'solid-js';

import { GitPatchViewer } from '../widgets/GitPatchViewer';
import { buildCodexAdaptedFileChange } from './fileChangeDiff';
import type { CodexFileChange } from './types';

export function CodexFileChangeDiff(props: {
  change: CodexFileChange;
}) {
  const adapted = createMemo(() => buildCodexAdaptedFileChange(props.change));

  return (
    <div class="codex-chat-file-change">
      <GitPatchViewer
        class="min-h-0"
        item={adapted().file}
        emptyMessage="No file change details were provided yet."
        showCopyButton={false}
        showMobileHint={false}
        desktopPatchViewportClass="max-h-[22rem]"
        mobilePatchViewportClass="max-h-none"
      />
    </div>
  );
}

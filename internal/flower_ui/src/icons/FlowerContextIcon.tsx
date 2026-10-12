import { Show, createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Activity, FileText, Terminal } from '@floegence/floe-webapp-core/icons';
import type { FlowerTurnLauncherContextTone } from '../flowerTurnLauncherCopy';

/** Shared identity for launcher drafts and submitted message references. */
export function FlowerContextIcon(props: {
  tone: FlowerTurnLauncherContextTone;
  name: string;
}) {
  const fileIdentity = () => ['file', 'directory', 'selection', 'attachment'].includes(props.tone);
  const contextualIcon = createMemo(() => props.tone === 'terminal'
    ? Terminal
    : props.tone === 'environment' || props.tone === 'process' ? Activity : FileText);
  return <Show when={fileIdentity()} fallback={<Dynamic component={contextualIcon()} class="size-4 shrink-0" aria-hidden="true" />}>
    <FileItemIcon size={16} item={{ name: props.name, type: props.tone === 'directory' ? 'folder' : 'file' }} class="size-4 shrink-0" />
  </Show>;
}

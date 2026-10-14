import { Show, createMemo, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Activity, FileText, Terminal, MessageSquare } from '@floegence/floe-webapp-core/icons';
import type { FlowerTurnLauncherContextTone } from '../flowerTurnLauncherCopy';

/** A page frame with a quoted context marker, distinct from file references. */
const FlowerPageContextIcon: Component<{ class?: string }> = props => (
  <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-flower-context-icon="page_context">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 9h18M7 6.5h.01M10 6.5h.01M8 12.5h3v3H8v-3Zm5 0h3v3h-3v-3ZM11 15.5c0 1.2-.7 2-2 2.5M16 15.5c0 1.2-.7 2-2 2.5" />
  </svg>
);

/** Shared identity for launcher drafts and submitted message references. */
export function FlowerContextIcon(props: {
  tone: FlowerTurnLauncherContextTone | 'page_context';
  name: string;
}) {
  const fileIdentity = () => ['file', 'directory', 'selection', 'attachment'].includes(props.tone);
  const contextualIcon = createMemo(() => props.tone === 'thread' ? MessageSquare : props.tone === 'page_context' ? FlowerPageContextIcon : props.tone === 'terminal'
    ? Terminal
    : props.tone === 'environment' || props.tone === 'process' ? Activity : FileText);
  return <Show when={fileIdentity()} fallback={<Dynamic component={contextualIcon()} class="size-4 shrink-0" aria-hidden="true" />}>
    <FileItemIcon size={16} item={{ name: props.name, type: props.tone === 'directory' ? 'folder' : 'file' }} class="size-4 shrink-0" />
  </Show>;
}

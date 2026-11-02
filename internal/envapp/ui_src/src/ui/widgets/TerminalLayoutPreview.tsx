import { For, createMemo } from 'solid-js';
import { measureSplitWorkspace, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { emptyViewSlots } from '../services/terminalViewLayout';

/** The same geometry thumbnail is used by view rows and arrangement choices. */
export function TerminalLayoutPreview(props: { layout: SplitWorkspaceLayout; class?: string }) {
  const panes = createMemo(() => [...measureSplitWorkspace(props.layout).panes.entries()]);
  const inset = createMemo(() => Math.min(2, ...panes().map(([, rect]) => Math.min(rect.width, rect.height * .72) * .2)));
  const empty = createMemo(() => emptyViewSlots(props.layout));
  return <svg class={props.class} viewBox="0 0 100 72" aria-hidden="true" data-terminal-layout-preview>
    <For each={panes()}>{([id, rect]) => <rect x={rect.x + inset()} y={rect.y * .72 + inset()} width={Math.max(0, rect.width - inset() * 2)} height={Math.max(0, rect.height * .72 - inset() * 2)} rx={inset()} data-empty={empty().has(id) ? 'true' : undefined} />}</For>
  </svg>;
}

import { untrack, type JSX } from 'solid-js';
import { type DialogProps } from '@floegence/floe-webapp-core/ui';
import { Dialog } from '../primitives/EnvAppModal';

// Create the management content under this stable owner. Closing the shared
// Dialog removes its overlay while keeping search, selection, and scroll state.
export function PluginCenterDialog(props: DialogProps): JSX.Element {
  const content = untrack(() => props.children);
  return <Dialog {...props}>
    <div class="h-[min(780px,calc(100dvh-160px))] min-h-0 overflow-hidden">{content}</div>
  </Dialog>;
}

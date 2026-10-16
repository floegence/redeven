import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { DesktopActionPopover } from '../../src/welcome/DesktopActionPopover';
import '../../src/welcome/index.css';

declare global { interface Window { continuityLayers: { open: (value: boolean) => void; exits: number } } }
const [open, setOpen] = createSignal(true);
const [nested, setNested] = createSignal(false);
window.continuityLayers = { open: setOpen, exits: 0 };
render(() => <div style={{ padding: '12px' }}>
  <DesktopActionPopover open={open()} onOpenChange={setOpen} onExitComplete={() => window.continuityLayers.exits++}
    placementLock="top-inline-shift" content={<div style={{ padding: '12px' }}><input aria-label="Parent draft" /><button onClick={() => setNested(true)}>Open child</button></div>}>
    <button onClick={() => setOpen(value => !value)}>Anchor</button>
  </DesktopActionPopover>
  <Dialog open={nested()} onOpenChange={setNested} title="Child dialog"><input aria-label="Child draft" /></Dialog>
  <button style={{ position: 'fixed', bottom: '12px', right: '12px' }}>Outside</button>
</div>, document.getElementById('root')!);

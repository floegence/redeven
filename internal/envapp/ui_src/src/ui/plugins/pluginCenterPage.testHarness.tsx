import { createSignal, type JSX } from 'solid-js';
import { DialogPlacementProvider } from '@floegence/floe-webapp-core/ui';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { PluginPageViewport } from './PluginPageViewport';

/** A fixed shell viewport; the real page owner stays outside its retained canvas. */
export function PluginCenterPageFixture(props: { open: boolean; children: JSX.Element; background?: JSX.Element; onShellAction?: () => void }) {
  const [host, setHost] = createSignal<HTMLElement>();
  const [content, setContent] = createSignal<HTMLElement | null>(null);
  return <div ref={setHost} style={{ position: 'relative', height: '100vh', width: '100%' }}>
    <header style={{ height: '48px' }}><button data-test-shell-action onClick={props.onShellAction}>Shell action</button></header>
    <nav data-test-shell-rail style={{ position: 'absolute', top: '48px', left: 0, bottom: 0, width: '48px' }} />
    <main ref={setContent} style={{ position: 'absolute', left: '48px', right: 0, top: '48px', bottom: 0 }}>
      <div data-test-workbench-background inert={props.open} aria-hidden={props.open || undefined}
        style={{ height: '100%', visibility: props.open ? 'hidden' : undefined }}>{props.background}</div>
    </main>
    <PluginPageViewport page="center" host={host()} content={content()} visible={props.open} blocked={false}>
      <DialogPlacementProvider mode="global" globalZIndex={ENV_APP_FLOATING_LAYER.productModal}>{props.children}</DialogPlacementProvider>
    </PluginPageViewport>
  </div>;
}

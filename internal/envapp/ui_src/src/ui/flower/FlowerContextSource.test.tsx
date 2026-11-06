// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createFlowerContextSources, FlowerContextSource, FlowerContextSources, registerFlowerPageReader } from './FlowerContextSource';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
describe('global Flower source boundary', () => {
  it('captures the selected instance and freezes its reader before prompt focus', () => {
    const registry = createFlowerContextSources(); let directory = '/one';
    function Page(props: { id: string }) { registerFlowerPageReader(() => ({ directory: props.id === 'one' ? directory : '/two' })); return <button>{props.id}</button>; }
    const host = document.createElement('div'); document.body.append(host);
    dispose = render(() => <FlowerContextSources.Provider value={registry}>
      <FlowerContextSource id="one" pageID="files" pageName="Files" mode="workbench"><Page id="one" /></FlowerContextSource>
      <FlowerContextSource id="two" pageID="files" pageName="Files" mode="workbench"><Page id="two" /></FlowerContextSource>
    </FlowerContextSources.Provider>, host);
    for (const element of host.querySelectorAll<HTMLElement>('[data-flower-context-source]')) element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 200 }) as DOMRect;
    host.querySelector('button')!.focus();
    const captured = registry.capture(); directory = '/changed';
    const prompt = document.createElement('textarea'); document.body.append(prompt); prompt.focus();
    expect(captured?.value.state?.directory).toBe('/one');
    expect(registry.capture()?.id).toBe(captured?.id);
    host.querySelectorAll('button')[1]!.focus(); expect(registry.capture()?.value.state?.directory).toBe('/two');
    registry.dispose();
  });
  it('keeps a nested reader when its page activates and drops a retired source', () => {
    const registry = createFlowerContextSources();
    let select!: (value: boolean) => void;
    const host = document.createElement('div'); document.body.append(host);
    dispose = render(() => { const [selected, setSelected] = createSignal(false); select = setSelected; return <FlowerContextSources.Provider value={registry}>
      <FlowerContextSource id="page" pageID="files" pageName="Files" mode="activity" selected={selected()} state={{ directory: '/parent' }}>
        <FlowerContextSource id="document" pageID="preview" pageName="Document" mode="overlay" state={{ path: '/child' }}><button>Document</button></FlowerContextSource>
      </FlowerContextSource>
    </FlowerContextSources.Provider>; }, host);
    for (const element of host.querySelectorAll<HTMLElement>('[data-flower-context-source]')) element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 200 }) as DOMRect;
    host.querySelector('button')!.focus(); select(true);
    expect(registry.capture()?.value.state?.path).toBe('/child');
    dispose!(); dispose = undefined;
    expect(registry.capture()).toBeUndefined(); registry.dispose();
  });
});

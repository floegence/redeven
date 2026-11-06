// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createFlowerContextSources, FlowerContextSource, FlowerContextSources, createFlowerContextTarget, registerFlowerPageReader } from './FlowerContextSource';
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

it('freezes the clicked object independently of an old selection and sibling instance', () => {
  const registry = createFlowerContextSources();
  const host = document.createElement('div'); document.body.append(host);
  let name = 'second container';
  function Objects() {
    registerFlowerPageReader(() => ({ view: 'containers', filter: 'active' }));
    return <><button id="first" ref={createFlowerContextTarget(() => ({ id: 'container-1', label: 'first container', state: { engine: 'docker' } }))}>First</button>
      <button id="second" ref={createFlowerContextTarget(() => ({ id: 'container-2', label: name, state: { engine: 'podman', endpoint_id: 'remote' } }))}>Second</button></>;
  }
  dispose = render(() => <FlowerContextSources.Provider value={registry}>
    <FlowerContextSource id="containers" pageID="containers" pageName="Containers" mode="workbench"><Objects /></FlowerContextSource>
  </FlowerContextSources.Provider>, host);
  for (const element of host.querySelectorAll<HTMLElement>('div,button')) element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 80 }) as DOMRect;
  host.querySelector<HTMLButtonElement>('#first')!.focus();
  const captured = registry.captureTarget(host.querySelector('#second')!);
  name = 'changed later';
  expect(captured?.value.pageName).toBe('second container');
  expect(captured?.value.state).toEqual({ engine: 'podman', endpoint_id: 'remote', subject: { id: 'container-2', name: 'second container' }, surface: { id: 'containers', name: 'Containers' } });
  expect(captured?.value.resourceKey).toBe('container-2');
  expect(registry.captureTarget(document.body)).toBeUndefined();
  registry.dispose();
});


it('owns a complete widget frame and blocks unavailable nested boundaries', () => {
  const registry = createFlowerContextSources();
  const host = document.createElement('div'); document.body.append(host);
  let enable!: (value: boolean) => void;
  dispose = render(() => { const [enabled, setEnabled] = createSignal(true); enable = setEnabled; return <FlowerContextSources.Provider value={registry}>
    <FlowerContextSource id="canvas" pageID="workbench" pageName="Workbench" mode="workbench">
      <article data-widget><header><button>Widget title</button></header>
        <FlowerContextSource id="widget" pageID="files" pageName="Project" mode="workbench" enabled={enabled()}
          boundary={body => body.closest<HTMLElement>('[data-widget]')!} state={{ directory: '/project' }}><p>Body</p></FlowerContextSource>
      </article>
    </FlowerContextSource>
  </FlowerContextSources.Provider>; }, host);
  for (const element of host.querySelectorAll<HTMLElement>('div,article')) element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 80 }) as DOMRect;
  const title = host.querySelector('button')!;
  expect(registry.captureTarget(title)?.value.state).toEqual({ directory: '/project' });
  title.focus(); expect(registry.capture()?.value.pageName).toBe('Project');
  enable(false);
  expect(registry.captureTarget(title)).toBeUndefined();
  expect(registry.capture()).toBeUndefined();
  registry.dispose();
});

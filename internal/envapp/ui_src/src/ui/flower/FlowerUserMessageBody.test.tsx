// @vitest-environment jsdom

import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerUserMessageBody } from '../../../../../flower_ui/src/chat/FlowerUserMessageBody';
import type { FlowerRenderableMessageBlock } from '../../../../../flower_ui/src/flowerTimelineProjection';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const content = (value: string): FlowerRenderableMessageBlock => ({ type: 'content', key: 'body', block_index: 0, block_type: 'text', content: value });
const image = (key: string): FlowerRenderableMessageBlock => ({ type: 'image', key, block_index: 1, src: key });
const file = (key: string): FlowerRenderableMessageBlock => ({ type: 'file', key, block_index: 2, name: key, mimeType: 'application/pdf' });

function mount(initial: readonly FlowerRenderableMessageBlock[], hasReferences = false) {
  const [blocks, setBlocks] = createSignal(initial);
  const [references, setReferences] = createSignal(hasReferences);
  const host = document.createElement('div');
  document.body.append(host);
  const rendered = vi.fn();
  dispose = render(() => <FlowerUserMessageBody blocks={blocks()} hasReferences={references()}
    references={<span data-reference>Frozen reference</span>}
    renderBlock={block => {
      rendered(block().key);
      return <span data-block={block().key} data-type={block().type}>{block().type === 'content' ? (block() as Extract<FlowerRenderableMessageBlock, { type: 'content' }>).content : block().key}</span> as JSX.Element;
    }} />, host);
  return { host, setBlocks, setReferences, rendered };
}

describe('Flower user message composition', () => {
  it('places images and one shared resource row before text without changing input order', () => {
    const blocks = [content('Review the resources'), file('guide.pdf'), image('first.png'), file('notes.txt'), image('second.png')];
    const { host } = mount(blocks, true);
    expect([...host.querySelectorAll('[data-block]')].map(node => node.getAttribute('data-block')))
      .toEqual(['first.png', 'second.png', 'guide.pdf', 'notes.txt', 'body']);
    expect([...host.querySelector('.flower-message-resources')!.children].map(node => node.textContent))
      .toEqual(['guide.pdf', 'notes.txt', 'Frozen reference']);
    expect(blocks.map(block => block.key)).toEqual(['body', 'guide.pdf', 'first.png', 'notes.txt', 'second.png']);
  });

  it.each([
    { blocks: [content('Text only')], references: false, images: 0, resources: 0, bodies: 1 },
    { blocks: [image('only.png'), content('  ')], references: false, images: 1, resources: 0, bodies: 0 },
    { blocks: [file('only.pdf')], references: false, images: 0, resources: 1, bodies: 0 },
    { blocks: [content('')], references: true, images: 0, resources: 1, bodies: 0 },
    { blocks: [], references: false, images: 0, resources: 0, bodies: 0 },
  ])('omits empty media, resources and body containers: $images/$resources/$bodies', fixture => {
    const { host } = mount(fixture.blocks, fixture.references);
    expect(host.querySelectorAll('.flower-message-images')).toHaveLength(fixture.images);
    expect(host.querySelectorAll('.flower-message-resources')).toHaveLength(fixture.resources);
    expect(host.querySelectorAll('[data-type="content"]')).toHaveLength(fixture.bodies);
  });

  it('retains loaded media and focused resource nodes through message and context updates', () => {
    const { host, setBlocks, setReferences, rendered } = mount([image('stable.png'), file('stable.pdf'), content('Before')]);
    const media = host.querySelector('[data-block="stable.png"]');
    const resource = host.querySelector<HTMLElement>('[data-block="stable.pdf"]')!;
    resource.tabIndex = 0;
    resource.focus();
    for (let index = 0; index < 100; index++) {
      setBlocks([image('stable.png'), file('stable.pdf'), content('After ' + index)]);
      setReferences(index % 2 === 0);
    }
    expect(host.querySelector('[data-block="stable.png"]')).toBe(media);
    expect(host.querySelector('[data-block="stable.pdf"]')).toBe(resource);
    expect(document.activeElement).toBe(resource);
    expect(host.textContent).toContain('After 99');
    expect(rendered).toHaveBeenCalledTimes(3);
  });
});

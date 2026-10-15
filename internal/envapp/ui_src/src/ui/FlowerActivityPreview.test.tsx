// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { FlowerActivityPreview } from '../../../../flower_ui/src/FlowerActivityPreview';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { presentFlowerActivityItem, type FlowerActivityDetailBlock } from '../../../../flower_ui/src/flowerActivityPresentation';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
const mount = (block: Extract<FlowerActivityDetailBlock, { kind: 'structured_rows' }>) => {
  const host = document.createElement('div');
  document.body.append(host);
  disposers.push(render(() => <FlowerActivityPreview block={block} copy={DEFAULT_FLOWER_SURFACE_COPY.chat} />, host));
  return host;
};

it('shows the search itself without parameter labels or technical options', () => {
  const payload = { inputs: [
    { title: 'query', content: 'release', format: 'text' },
    { title: 'object', content: 'messages', format: 'text' },
    { title: 'limit', content: '50', format: 'text' },
  ], rows: [], rows_provided: true };
  const original = JSON.stringify(payload);
  const presentation = presentFlowerActivityItem({
    item_id: 'search', tool_id: 'search', tool_name: 'threads.query', kind: 'tool',
    renderer: 'structured', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false, payload,
  });
  const block = presentation.detailBlocks.find(block => block.kind === 'structured_rows' && block.section === 'inputs');
  expect(block?.kind).toBe('structured_rows');
  const host = mount(block as Extract<FlowerActivityDetailBlock, { kind: 'structured_rows' }>);
  expect(host.textContent).toBe('release');
  expect(JSON.stringify(payload)).toBe(original);
});

it('previews three results and reveals the rest only on request', () => {
  const host = mount({ kind: 'structured_rows', section: 'results', rows: Array.from({ length: 8 }, (_, index) => ({
    title: `Release ${index + 1}`, content: `Public summary ${index + 1}`, meta: 'assistant', format: 'text',
  })) });
  expect(host.querySelectorAll('.flower-activity-preview-row')).toHaveLength(3);
  expect(host.textContent).not.toContain('assistant');
  expect(host.textContent).not.toContain('Release 4');
  const more = host.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!;
  more.click();
  expect(host.querySelectorAll('.flower-activity-preview-row')).toHaveLength(8);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  more.click();
  expect(host.querySelectorAll('.flower-activity-preview-row')).toHaveLength(3);
});

it('starts a long result as a bounded preview without changing its literal content', () => {
  const content = '  First line\nSecond line\nThird line\nFourth line';
  const host = mount({ kind: 'structured_rows', section: 'results', rows: [{ title: 'Release notes', meta: '', content, format: 'text' }] });
  const preview = host.querySelector('.flower-activity-preview')!;
  expect(preview.getAttribute('data-expanded')).toBe('false');
  expect(preview.querySelector('.flower-activity-preview-text')?.textContent).toBe(content);
  host.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!.click();
  expect(preview.getAttribute('data-expanded')).toBe('true');
  expect(preview.querySelector('.flower-activity-preview-text')?.textContent).toBe(content);
});

it('keeps existing edit, terminal, and search details on their original presenters', () => {
  for (const [tool_name, renderer] of [['tessiven.edit', 'structured'], ['file.edit', 'file'], ['terminal.exec', 'terminal'], ['rgrep', 'structured']] as const) {
    const presentation = presentFlowerActivityItem({
      item_id: tool_name, tool_id: tool_name, tool_name, renderer, kind: 'tool',
      status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      payload: { inputs: [{ content: '-before\n+after', format: 'code', language: 'diff' }], rows: [{ title: 'app.ts', content: 'Original result', format: 'text' }], rows_provided: true },
    });
    expect(presentation.detailBlocks.some(block => block.kind === 'structured_rows' && block.preview)).toBe(false);
  }
});

it('explains a missing preview without claiming that the tool returned nothing', () => {
  const presentation = presentFlowerActivityItem({
    item_id: 'query', tool_id: 'query', tool_name: 'threads.query', renderer: 'structured', kind: 'tool',
    status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
    payload: { rows_provided: true },
  });
  expect(JSON.stringify(presentation.detailBlocks)).toContain('did not provide a result preview');
  expect(JSON.stringify(presentation.detailBlocks)).not.toContain('No output');
});

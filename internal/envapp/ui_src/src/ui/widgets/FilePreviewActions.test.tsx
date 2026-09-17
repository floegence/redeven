// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewActions } from './FilePreviewActions';

vi.mock('./FloatingContextMenu', () => ({
  FloatingContextMenu: (props: any) => (
    <div role="menu">
      {props.items.map((item: any) => (
        <button role="menuitem" disabled={item.disabled} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});
const item = { id: '/workspace/demo.md', path: '/workspace/demo.md', name: 'demo.md', type: 'file' as const };
function button(host: ParentNode, label: string) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (el) => el.getAttribute('aria-label') === label || el.textContent === label,
  )!;
}

describe('File preview action presentations', () => {
  it.each(['icons', 'menu'] as const)('shares edit availability and copy feedback in %s', async (presentation) => {
    const host = document.createElement('div');
    document.body.append(host);
    const [editing, setEditing] = createSignal(false);
    const [saving, setSaving] = createSignal(false);
    const save = vi.fn();
    const copy = vi.fn(async () => true);
    const dispose = render(
      () => (
        <FilePreviewActions
          presentation={presentation}
          item={item}
          descriptor={{ mode: 'markdown' }}
          canEdit
          editing={editing()}
          saving={saving()}
          dirty
          onStartEdit={() => setEditing(true)}
          onSave={save}
          onCopyPath={copy}
        />
      ),
      host,
    );
    const open = () => {
      if (presentation === 'menu') button(host, 'More file actions').click();
    };
    try {
      open();
      button(host, 'Copy path').click();
      await Promise.resolve();
      await Promise.resolve();
      expect(host.querySelector('[title="Path copied"]')).toBeTruthy();
      open();
      button(host, 'Edit file').click();
      open();
      expect(button(host, 'Save file').disabled).toBe(false);
      setSaving(true);
      expect(button(host, 'Save file').disabled).toBe(true);
      expect(button(host, 'Discard changes').disabled).toBe(true);
      setSaving(false);
      button(host, 'Save file').click();
      expect(save).toHaveBeenCalledOnce();
      expect(copy).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('captures only this preview selection for the menu and clears it when the file changes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const body = document.createElement('div');
    body.textContent = 'Preview selection';
    document.body.append(body);
    const other = document.createElement('div');
    other.textContent = 'Other selection';
    document.body.append(other);
    const [file, setFile] = createSignal(item);
    const [presentation, setPresentation] = createSignal<'icons' | 'menu'>('menu');
    const ask = vi.fn();
    const select = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    const open = () => {
      const more = button(host, 'More file actions');
      more.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      more.click();
    };
    const dispose = render(
      () => (
        <FilePreviewActions
          presentation={presentation()}
          item={file()}
          descriptor={{ mode: 'markdown' }}
          contentElement={body}
          onAskFlower={ask}
        />
      ),
      host,
    );
    try {
      select(body);
      open();
      window.getSelection()!.removeAllRanges();
      button(host, 'Ask Flower').click();
      expect(ask).toHaveBeenLastCalledWith('Preview selection');
      select(other);
      open();
      button(host, 'Ask Flower').click();
      expect(ask).toHaveBeenLastCalledWith('');
      select(body);
      open();
      setFile({ ...item, path: '/workspace/next.md' });
      expect(host.querySelector('[role="menu"]')).toBeNull();
      open();
      setPresentation('icons');
      expect(host.querySelector('[role="menu"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});

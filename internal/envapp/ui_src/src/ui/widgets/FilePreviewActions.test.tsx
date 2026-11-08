// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewSearchScope, registerFilePreviewSearch } from './FilePreviewSearch';
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
  it('offers popout in More for the active loaded document only', () => {
    const host = document.createElement('div'); document.body.append(host);
    const run = vi.fn(); const [busy, setBusy] = createSignal(false);
    const dispose = render(() => <FilePreviewActions item={item} descriptor={{ mode: 'markdown' }} presentation="header"
      onOpenSeparately={run} openSeparatelyLabel="Open in new tab" openingSeparately={busy()} />, host);
    try {
      button(host, 'More file actions').click(); button(host, 'Open in new tab').click(); expect(run).toHaveBeenCalledOnce();
      setBusy(true); button(host, 'More file actions').click(); expect(button(host, 'Open in new tab').disabled).toBe(true);
    } finally { dispose(); }
  });
  it.each(['icons', 'menu', 'header'] as const)('places Find only in More for %s actions', presentation => {
    const host = document.createElement('div'); document.body.append(host);
    const show = vi.fn();
    const [active, setActive] = createSignal(true);
    const Content = () => { registerFilePreviewSearch({ show, enabled: active }); return null; };
    const dispose = render(() => <FilePreviewSearchScope><FilePreviewActions presentation={presentation} item={item} descriptor={{ mode: 'markdown' }} active={active()} /><Content /></FilePreviewSearchScope>, host);
    try {
      expect(host.querySelector('[data-redeven-preview-find]')).toBeNull();
      button(host, 'More file actions').click();
      const find = button(host, 'Find in file'); expect(find.getAttribute('role')).toBe('menuitem');
      find.click(); expect(show).toHaveBeenCalledWith(button(host, 'More file actions'));
      expect(host.querySelector('[role="menu"]')).toBeNull();
      setActive(false); button(host, 'More file actions').click(); expect(button(host, 'Find in file').disabled).toBe(true);
    } finally { dispose(); }
  });

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
      more.getBoundingClientRect = () => ({ left: 720, top: 408, right: 752, bottom: 440, width: 32, height: 32 }) as DOMRect;
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
      expect(ask).toHaveBeenLastCalledWith('Preview selection', { x: 720, y: 444 });
      select(other);
      open();
      button(host, 'Ask Flower').click();
      expect(ask).toHaveBeenLastCalledWith('', { x: 720, y: 444 });
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

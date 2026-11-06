import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, ContextMenuParams, WebContents } from 'electron';
import { REDEVEN_SUPPORTED_LOCALES } from '../shared/i18n';
import { attachDesktopEditContextMenu, desktopEditMenuItems } from './editContextMenu';

const native = vi.hoisted(() => ({ popup: vi.fn(), closePopup: vi.fn(), build: vi.fn() }));
vi.mock('electron', () => ({ Menu: { buildFromTemplate: native.build } }));
const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };
const params = { isEditable: true, selectionText: 'selected text', editFlags: flags, x: 12, y: 20, frame: {}, menuSourceType: 'mouse' } as ContextMenuParams;

describe('native edit context menu', () => {
  it.each(REDEVEN_SUPPORTED_LOCALES)('localizes all editing actions for %s', locale => {
    const items = desktopEditMenuItems(params, locale).filter(item => item.role);
    expect(items.map(item => item.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    expect(items.map(item => item.enabled)).toEqual([true, false, true, true, true, true]);
    expect(items.every(item => item.label && !item.label.startsWith('editContextMenu.'))).toBe(true);
    if (locale !== 'en-US') expect(items.map(item => item.label)).not.toEqual(desktopEditMenuItems(params, 'en-US').filter(item => item.role).map(item => item.label));
  });

  it('keeps Copy visible but disabled for an empty editor and respects read-only flags', () => {
    const items = desktopEditMenuItems({ ...params, selectionText: '', editFlags: { ...flags, canCopy: false, canCut: false, canPaste: false } }, 'en-US');
    for (const role of ['copy', 'cut', 'paste']) expect(items.find(item => item.role === role)?.enabled).toBe(false);
  });

  it('offers only Copy for a reading selection and no empty background menu', () => {
    expect(desktopEditMenuItems({ ...params, isEditable: false }, 'zh-CN')).toEqual([{ role: 'copy', label: '复制', enabled: true }]);
    expect(desktopEditMenuItems({ ...params, isEditable: false, selectionText: '' }, 'en-US')).toEqual([]);
  });

  it('keeps the originating frame and closes on navigation or window close', () => {
    native.build.mockReturnValue(native);
    native.popup.mockClear();
    native.closePopup.mockClear();
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
    attachDesktopEditContextMenu(window as unknown as BrowserWindow, () => 'zh-CN');
    contents.emit('context-menu', {}, params);
    expect(native.popup).toHaveBeenCalledWith(expect.objectContaining({ window, frame: params.frame, x: 12, y: 20, sourceType: 'mouse' }));
    contents.emit('did-start-navigation');
    expect(native.closePopup).toHaveBeenCalledWith(window);
    contents.emit('context-menu', {}, params);
    window.emit('close');
    expect(native.closePopup).toHaveBeenCalledTimes(2);
  });
});

it('adds an owned-window action on blank content while keeping native frame editing', () => {
  native.build.mockReturnValue(native);
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const ask = vi.fn();
  attachDesktopEditContextMenu(window as unknown as BrowserWindow, () => 'en-US', {
    actions: origin => [{ id: 'assistant.ask.flower', label: 'Ask Flower', click: () => ask(origin.selectionText) }],
  });
  contents.emit('context-menu', {}, { ...params, isEditable: false, selectionText: '' });
  expect(native.build.mock.lastCall?.[0]).toEqual([expect.objectContaining({ id: 'assistant.ask.flower' })]);
  contents.emit('context-menu', {}, params);
  const items = native.build.mock.lastCall?.[0];
  expect(items.map((item: {role?:string}) => item.role).filter(Boolean)).toContain('paste');
  items[0].click(); expect(ask).toHaveBeenCalledWith('selected text');
  expect(native.popup).toHaveBeenLastCalledWith(expect.objectContaining({ frame: params.frame }));
});

it('binds a separate content view without consuming its parent window requests', () => {
  native.build.mockReturnValue(native);
  native.popup.mockClear();
  native.closePopup.mockClear();
  const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents: parent, isDestroyed: () => false });
  attachDesktopEditContextMenu(window as unknown as BrowserWindow, () => 'en-US', {
    contents: contents as unknown as WebContents,
    actions: () => [{ id: 'assistant.ask.flower', label: 'Ask Flower', click: vi.fn() }],
  });
  parent.emit('context-menu', {}, params);
  expect(native.popup).not.toHaveBeenCalled();
  contents.emit('context-menu', {}, params);
  expect(native.popup).toHaveBeenCalledOnce();
  contents.emit('did-start-navigation');
  expect(native.closePopup).toHaveBeenCalledWith(window);
});

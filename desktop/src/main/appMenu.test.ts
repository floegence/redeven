import { describe, expect, it } from 'vitest';

import { buildAppMenuTemplate } from './appMenu';
import { createDesktopI18n } from '../shared/i18n/desktopI18n';
import type { RedevenLocale } from '../shared/i18n/localeMeta';

function buildMenu(platform: NodeJS.Platform, locale: RedevenLocale = 'en-US') {
  return buildAppMenuTemplate({
    openConnectionCenter: () => undefined,
    openAdvancedSettings: () => undefined,
    requestQuit: () => undefined,
  }, createDesktopI18n(locale), platform);
}

describe('appMenu', () => {
  it('includes the Connect Environment shell entry and quit accelerator on macOS', () => {
    const template = buildMenu('darwin');

    const items = template.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : []);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Connect Environment...', accelerator: 'CommandOrControl+Shift+O' }),
      expect.objectContaining({ label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q' }),
    ]));
  });

  it('includes a native Edit menu with copy support on macOS', () => {
    const template = buildMenu('darwin');

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'File',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'close' }),
        ]),
      }),
      expect.objectContaining({
        label: 'View',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'togglefullscreen' }),
        ]),
      }),
      expect.objectContaining({ role: 'windowMenu' }),
      expect.objectContaining({
        label: 'Edit',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'copy' }),
          expect.objectContaining({ role: 'selectAll' }),
          expect.objectContaining({ role: 'pasteAndMatchStyle' }),
        ]),
      }),
    ]));
  });

  it('includes a native Edit menu with copy support on non-macOS platforms', () => {
    const template = buildMenu('linux');

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'File' }),
      expect.objectContaining({
        label: 'View',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'togglefullscreen' }),
        ]),
      }),
      expect.objectContaining({
        label: 'Edit',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'copy' }),
          expect.objectContaining({ role: 'selectAll' }),
        ]),
      }),
      expect.objectContaining({
        label: 'Window',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'minimize' }),
          expect.objectContaining({ role: 'zoom' }),
          expect.objectContaining({ role: 'close' }),
        ]),
      }),
    ]));
  });

  it('routes menu chrome through the current Desktop locale', () => {
    const template = buildMenu('linux', 'zh-CN');

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '文件' }),
      expect.objectContaining({ label: '编辑' }),
      expect.objectContaining({ label: '视图' }),
      expect.objectContaining({ label: '窗口' }),
    ]));
    expect(template.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '连接 Environment...' }),
      expect.objectContaining({ label: '退出 Redeven Desktop' }),
    ]));
  });
});

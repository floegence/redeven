import { describe, expect, it } from 'vitest';

import { buildAppMenuTemplate } from './appMenu';

function buildMenu(platform: NodeJS.Platform) {
  return buildAppMenuTemplate({
    openConnectionCenter: () => undefined,
    openAdvancedSettings: () => undefined,
    requestQuit: () => undefined,
  }, platform);
}

describe('appMenu', () => {
  it('includes the single switch-device shell entry and quit accelerator on macOS', () => {
    const template = buildMenu('darwin');

    const items = template.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : []);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Switch Device...', accelerator: 'CommandOrControl+Shift+O' }),
      expect.objectContaining({ label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q' }),
    ]));
  });

  it('includes a native Edit menu with copy support on macOS', () => {
    const template = buildMenu('darwin');

    expect(template).toEqual(expect.arrayContaining([
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
        label: 'Edit',
        submenu: expect.arrayContaining([
          expect.objectContaining({ role: 'copy' }),
          expect.objectContaining({ role: 'selectAll' }),
        ]),
      }),
    ]));
  });
});

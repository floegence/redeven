import { describe, expect, it } from 'vitest';

import { buildAppMenuTemplate } from './appMenu';

describe('appMenu', () => {
  it('includes settings and quit accelerators', () => {
    const template = buildAppMenuTemplate({
      openSettings: () => undefined,
      requestQuit: () => undefined,
    });

    const items = template.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : []);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Settings...', accelerator: 'CommandOrControl+,' }),
      expect.objectContaining({ label: 'Quit Redeven Desktop', accelerator: 'CommandOrControl+Q' }),
    ]));
  });
});

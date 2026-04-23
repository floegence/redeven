// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvWorkbenchConversationShell } from './EnvWorkbenchConversationShell';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EnvWorkbenchConversationShell', () => {
  it('keeps the conversation rail inline instead of switching to a compact overlay', () => {
    const host = document.createElement('div');
    host.style.width = '420px';
    document.body.appendChild(host);

    const dispose = render(() => (
      <EnvWorkbenchConversationShell
        railLabel="Codex threads"
        rail={<div data-testid="thread-rail">Threads</div>}
        workbench={<div data-testid="conversation-workbench">Transcript</div>}
      />
    ), host);

    try {
      const rail = host.querySelector('aside') as HTMLElement | null;
      expect(rail).not.toBeNull();
      expect(rail?.className).toContain('w-[19rem]');
      expect(rail?.className).not.toContain('absolute');
      expect(host.querySelector('[data-testid="thread-rail"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="conversation-workbench"]')).not.toBeNull();
      expect(host.querySelector('button')).toBeNull();
    } finally {
      dispose();
    }
  });
});

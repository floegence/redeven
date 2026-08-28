import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { ManagedTemplateNotices } from './EnvPortForwardsPage';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EnvPortForwardsPage browser presentation', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it('keeps notice geometry and scroll position fixed when acknowledgement changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [accepted, setAccepted] = createSignal(false);
    const notice = {
      id: 'interactive-desktop-root-and-network',
      revision: 1,
      severity: 'warning' as const,
      title_key: 'webServices.managed.notices.interactiveDesktopRoot.title',
      description_key: 'webServices.managed.notices.interactiveDesktopRoot.description',
      acknowledgement_required: true,
    };
    dispose = render(() => (
      <div data-testid="notice-scroll-viewport" style="height: 180px; overflow: auto;">
        <div style="height: 120px;" />
        <ManagedTemplateNotices
          notices={[notice]}
          accepted={{ [notice.id]: accepted() }}
          disabled={false}
          onAcceptedChange={(_noticeID, checked) => setAccepted(checked)}
        />
        <div data-testid="notice-following-content" style="height: 120px;" />
      </div>
    ), host);

    const viewport = document.querySelector<HTMLElement>('[data-testid="notice-scroll-viewport"]')!;
    const noticeCard = document.querySelector<HTMLElement>('[data-notice-id]')!;
    const followingContent = document.querySelector<HTMLElement>('[data-testid="notice-following-content"]')!;
    const checkboxLabel = document.querySelector<HTMLInputElement>('[data-testid="managed-template-notices"] input[type="checkbox"]')!.closest('label')!;
    viewport.scrollTop = 90;
    const before = {
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      noticeHeight: noticeCard.getBoundingClientRect().height,
      followingTop: followingContent.getBoundingClientRect().top,
    };

    await userEvent.click(checkboxLabel);
    await settle();

    expect(accepted()).toBe(true);
    expect(viewport.scrollTop).toBe(before.scrollTop);
    expect(viewport.scrollHeight).toBe(before.scrollHeight);
    expect(noticeCard.getBoundingClientRect().height).toBe(before.noticeHeight);
    expect(followingContent.getBoundingClientRect().top).toBe(before.followingTop);
  });
});

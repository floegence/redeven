// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';
import { TerminalSearchOverlay } from './TerminalSearchOverlay';

describe('TerminalSearchOverlay', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('keeps a history RPC failure inline and exposes one explicit retry', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const retry = vi.fn();
    const dispose = render(() => (
      <I18nProvider>
        <TerminalSearchOverlay
          mobile={false}
          query="needle"
          resultCount={0}
          resultIndex={-1}
          state="error"
          inputRef={() => undefined}
          onQueryChange={() => undefined}
          onPrevious={() => undefined}
          onNext={() => undefined}
          onRetry={retry}
          onClose={() => undefined}
        />
      </I18nProvider>
    ), host);

    expect(host.querySelector('[data-terminal-search-state="error"]')?.textContent)
      .toContain('Some earlier output could not be restored.');
    const retryButton = host.querySelector<HTMLButtonElement>('[data-terminal-search-retry="true"]');
    expect(retryButton?.getAttribute('aria-label')).toBe('Retry');
    retryButton?.click();
    expect(retry).toHaveBeenCalledOnce();
    const resultNavigation = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => button.title === 'Previous' || button.title === 'Next');
    expect(resultNavigation).toHaveLength(2);
    expect(resultNavigation.every((button) => button.disabled)).toBe(true);

    dispose();
  });
});

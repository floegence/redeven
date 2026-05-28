// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextBlock } from './TextBlock';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TextBlock', () => {
  it('renders user and assistant text exactly without locale translation', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextBlock content={'Flower prompt: keep this exact English text.\n第二行也保持原文。'} />
    ), host);

    expect(host.textContent).toBe('Flower prompt: keep this exact English text.\n第二行也保持原文。');
  });
});

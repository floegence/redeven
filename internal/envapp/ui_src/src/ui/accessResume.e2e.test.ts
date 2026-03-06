// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { consumeAccessResumeTokenFromWindow } from './accessResume';

afterEach(() => {
  window.history.replaceState(null, document.title, '/');
});

describe('access resume window flow', () => {
  it('consumes the resume token and removes it from the address bar', () => {
    window.history.replaceState(null, document.title, '/_redeven_proxy/env/#redeven_access_resume=resume123&tab=files');

    const token = consumeAccessResumeTokenFromWindow(window);

    expect(token).toBe('resume123');
    expect(window.location.hash).toBe('#tab=files');
  });
});

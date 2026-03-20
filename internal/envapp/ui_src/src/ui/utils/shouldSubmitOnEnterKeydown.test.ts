import { describe, expect, it } from 'vitest';
import { shouldSubmitOnEnterKeydown } from './shouldSubmitOnEnterKeydown';

describe('shouldSubmitOnEnterKeydown', () => {
  it('submits on Enter when composition is inactive', () => {
    expect(shouldSubmitOnEnterKeydown({
      event: {
        isComposing: false,
        key: 'Enter',
        shiftKey: false,
      },
      isComposing: false,
    })).toBe(true);
  });

  it('does not submit on Shift+Enter', () => {
    expect(shouldSubmitOnEnterKeydown({
      event: {
        isComposing: false,
        key: 'Enter',
        shiftKey: true,
      },
      isComposing: false,
    })).toBe(false);
  });

  it('does not submit during native IME composition', () => {
    expect(shouldSubmitOnEnterKeydown({
      event: {
        isComposing: true,
        key: 'Enter',
        shiftKey: false,
      },
      isComposing: false,
    })).toBe(false);
  });

  it('does not submit while the controlled input tracks composition state', () => {
    expect(shouldSubmitOnEnterKeydown({
      event: {
        isComposing: false,
        key: 'Enter',
        shiftKey: false,
      },
      isComposing: true,
    })).toBe(false);
  });
});

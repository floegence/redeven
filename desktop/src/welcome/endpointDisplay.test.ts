import { describe, expect, it } from 'vitest';

import { endpointDisplayValue } from './endpointDisplay';

describe('endpointDisplayValue', () => {
  it('keeps short urls readable', () => {
    expect(endpointDisplayValue('https://dev.redeven.test/env/demo')).toBe('dev.redeven.test/env/demo');
  });

  it('truncates long urls in the middle', () => {
    expect(endpointDisplayValue('https://dev.redeven.test/env/env_a04ba30f6215c8b2f1dfc9b6d6f7f2f8a9b4e1c0?source=desktop#panel'))
      .toBe('dev.redeven.test/env/env_a04…desktop#panel');
  });

  it('falls back to raw text for non urls', () => {
    expect(endpointDisplayValue('ops@example.internal:2222')).toBe('ops@example.internal:2222');
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';

import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import { FlowerTurnProjectionUnavailable } from '../../../../../flower_ui/src/chat/FlowerTurnProjectionUnavailable';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
});

describe('FlowerTurnProjectionUnavailable', () => {
  it('renders the unavailable response at its timeline position without retry controls', () => {
    const host = document.createElement('div');
    document.body.append(host);
    disposers.push(render(() => (
      <FlowerTurnProjectionUnavailable
        decoration={{
          decoration_id: 'turn-projection-unavailable:turn-1',
          kind: 'turn_projection_unavailable',
          anchor: { target_kind: 'message', message_id: 'msg-user', edge: 'after' },
          ordinal: 0,
          projection_unavailable: {
            turn_id: 'turn-1',
            run_id: 'run-1',
            expected_message_id: 'msg-assistant',
            reason: 'not_found',
          },
        }}
        copy={DEFAULT_FLOWER_SURFACE_COPY}
      />
    ), host));

    const entry = host.querySelector('[data-flower-turn-projection-unavailable]');
    expect(entry?.textContent).toContain('Response unavailable');
    expect(entry?.textContent).toContain('The saved response for this turn could not be loaded.');
    expect(entry?.getAttribute('data-flower-turn-id')).toBe('turn-1');
    expect(entry?.getAttribute('data-flower-run-id')).toBe('run-1');
    expect(entry?.getAttribute('data-flower-expected-message-id')).toBe('msg-assistant');
    expect(entry?.querySelector('button')).toBeNull();
  });
});

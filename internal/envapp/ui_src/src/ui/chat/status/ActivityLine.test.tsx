// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityLine, ActivityStatusIcon, formatActivityDuration } from './ActivityLine';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ActivityLine', () => {
  it('renders a compact non-expandable activity row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <ActivityLine
        status="success"
        title="Edited desktop_bridge.go"
        meta="+12 -171"
        detail="click for diff"
      />
    ), host);

    expect(host.querySelector('.chat-activity-line-button')).toBeNull();
    expect(host.textContent).toContain('Edited desktop_bridge.go');
    expect(host.textContent).toContain('+12 -171');
    expect(host.textContent).toContain('click for diff');
    expect(host.querySelector('.chat-activity-status-icon-success')).toBeTruthy();
  });

  it('keeps details collapsed until the row is clicked', () => {
    const onToggle = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <ActivityLine
        status="running"
        title="Running go test"
        expandable
        expanded={false}
        controls="details"
        onToggle={onToggle}
      >
        <pre id="details">hidden output</pre>
      </ActivityLine>
    ), host);

    const button = host.querySelector('.chat-activity-line-button') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe('details');
    expect(host.textContent).not.toContain('hidden output');

    button?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('uses a quiet running dot instead of decorative loader markup', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <ActivityStatusIcon status="running" />, host);

    expect(host.querySelector('.chat-activity-running-dot')).toBeTruthy();
    expect(host.querySelector('svg')).toBeNull();
  });

  it('formats durations consistently for activity metadata', () => {
    expect(formatActivityDuration(undefined)).toBeUndefined();
    expect(formatActivityDuration(250)).toBe('250ms');
    expect(formatActivityDuration(1250)).toBe('1.3s');
    expect(formatActivityDuration(65_000)).toBe('1m 5s');
  });
});

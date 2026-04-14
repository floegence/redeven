// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeUpdateFloatingPrompt } from './RuntimeUpdateFloatingPrompt';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  FloatingWindow: (props: any) => (
    props.open ? (
      <div data-testid="floating-window">
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    ) : null
  ),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Refresh: Icon,
    X: Icon,
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RuntimeUpdateFloatingPrompt', () => {
  it('triggers update and skip actions in available mode', () => {
    const onUpdateNow = vi.fn();
    const onSkip = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <RuntimeUpdateFloatingPrompt
        open
        mode="available"
        currentVersion="v1.0.0"
        targetVersion="v1.1.0"
        onClose={() => undefined}
        onUpdateNow={onUpdateNow}
        onRetry={() => undefined}
        onSkip={onSkip}
      />
    ), host);

    expect(host.textContent).toContain('Update available');
    expect(host.textContent).toContain('v1.1.0');

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Update now'))?.click();
    buttons.find((button) => button.textContent?.includes('Skip this version'))?.click();

    expect(onUpdateNow).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows failure state and triggers retry', () => {
    const onRetry = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <RuntimeUpdateFloatingPrompt
        open
        mode="failed"
        currentVersion="v1.0.0"
        targetVersion="v1.1.0"
        error="Upgrade rejected."
        onClose={() => undefined}
        onUpdateNow={() => undefined}
        onRetry={onRetry}
        onSkip={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Update failed');
    expect(host.textContent).toContain('Upgrade rejected.');

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Retry'))?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

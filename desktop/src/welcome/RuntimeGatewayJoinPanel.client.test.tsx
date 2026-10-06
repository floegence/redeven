import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { RuntimeGatewayJoinPanel } from './RuntimeGatewayJoinPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';

let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
function button(label: string) {
  const found = [...document.querySelectorAll('button')].reverse().find(el => controlText(el) === label && !el.closest('[hidden], [aria-hidden="true"]'));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Runtime Gateway join interaction', () => {
  it('never submits on opening and preserves retry after failure and focus after cancel', async () => {
    vi.stubGlobal('CSS', { escape: (v: string) => v });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const perform = vi.fn(async () => ({ ok: false, code: 'GATEWAY_JOIN_FAILED' }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const root = document.createElement('div'); document.body.append(root);
    dispose = render(() => <RuntimeGatewayJoinPanel targetID="ssh:chosen" i18n={createDesktopI18n('en-US')} pending />, root);
    const trigger = button('Resume enrollment'); trigger.focus(); trigger.click(); await settle();
    expect(perform).not.toHaveBeenCalled();
    button('Resume enrollment').click(); await settle();
    expect(perform).toHaveBeenCalledWith({ kind: 'join_runtime_gateway_cloud', runtime_target_id: 'ssh:chosen' });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Saved consent is preserved');
    expect(button('Resume enrollment').disabled).toBe(false);
    button('Close').click(); await settle();
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps the open enrollment mounted as availability changes and reports connection success', async () => {
    vi.stubGlobal('CSS', { escape: (v: string) => v });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const [available, setAvailable] = createSignal(true);
    const focusOwner = vi.fn();
    const perform = vi.fn(async () => {
      setAvailable(false);
      return { ok: true, gateway_join_phase: 'connected' };
    });
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const root = document.createElement('div'); document.body.append(root);
    dispose = render(() => <RuntimeGatewayJoinPanel targetID="ssh:chosen" i18n={createDesktopI18n('en-US')} pending available={available()} focusOwner={focusOwner} />, root);
    const trigger = button('Resume enrollment'); trigger.click(); await settle();
    button('Resume enrollment').click(); await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Connected');
    expect(perform).toHaveBeenCalledTimes(1);
    button('Close').click(); await settle();
    expect(focusOwner).toHaveBeenCalledOnce();
    expect(trigger.hidden).toBe(true);
  });

});

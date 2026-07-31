/// <reference lib="dom" />

import { ipcRenderer } from 'electron';

import {
  DESKTOP_WEB_SERVICE_BROWSER_ACTION_CHANNEL,
  DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL,
  DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL,
  normalizeDesktopWebServiceBrowserActionResponse,
  normalizeDesktopWebServiceBrowserState,
  type DesktopWebServiceBrowserAction,
  type DesktopWebServiceBrowserState,
} from '../shared/desktopWebServiceBrowserIPC';

function elementByID<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id);
  return element instanceof HTMLElement ? element as T : null;
}

function bootstrap(): void {
  const form = elementByID<HTMLFormElement>('browser-form');
  const address = elementByID<HTMLInputElement>('browser-address');
  const back = elementByID<HTMLButtonElement>('browser-back');
  const forward = elementByID<HTMLButtonElement>('browser-forward');
  const reload = elementByID<HTMLButtonElement>('browser-reload');
  const status = elementByID<HTMLDivElement>('browser-status');
  const progress = elementByID<HTMLDivElement>('browser-progress');
  const reloadIcon = reload?.querySelector<SVGElement>('.reload-icon') ?? null;
  const stopIcon = reload?.querySelector<SVGElement>('.stop-icon') ?? null;
  if (!form || !address || !back || !forward || !reload || !status || !progress) return;

  let state = normalizeDesktopWebServiceBrowserState(null);
  let editingAddress = false;
  const browserTitle = document.title;

  const render = (next: DesktopWebServiceBrowserState): void => {
    state = next;
    if (!editingAddress) address.value = next.address;
    back.disabled = !next.can_go_back;
    forward.disabled = !next.can_go_forward;
    reload.title = next.loading ? reload.dataset.stopLabel ?? '' : reload.dataset.reloadLabel ?? '';
    reload.setAttribute('aria-label', reload.title);
    reloadIcon?.toggleAttribute('hidden', next.loading);
    stopIcon?.toggleAttribute('hidden', !next.loading);
    progress.dataset.loading = String(next.loading);
    status.textContent = next.error_message ?? '';
    status.dataset.visible = String(Boolean(next.error_message));
    document.title = next.title ? `${next.title} - ${browserTitle}` : browserTitle;
  };

  reload.dataset.reloadLabel = reload.getAttribute('title') ?? '';
  reload.dataset.stopLabel = reload.getAttribute('data-stop-label') ?? '';

  const perform = async (action: DesktopWebServiceBrowserAction): Promise<void> => {
    const response = normalizeDesktopWebServiceBrowserActionResponse(
      await ipcRenderer.invoke(DESKTOP_WEB_SERVICE_BROWSER_ACTION_CHANNEL, action),
    );
    if (!response.ok && response.message) {
      render({ ...state, error_message: response.message });
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    editingAddress = false;
    void perform({ action: 'navigate', address: address.value });
    address.blur();
  });
  address.addEventListener('focus', () => {
    editingAddress = true;
    address.select();
  });
  address.addEventListener('blur', () => {
    editingAddress = false;
    if (address.value.trim() === '') address.value = state.address;
  });
  address.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      address.value = state.address;
      address.blur();
    }
  });
  back.addEventListener('click', () => void perform({ action: 'back' }));
  forward.addEventListener('click', () => void perform({ action: 'forward' }));
  reload.addEventListener('click', () => void perform({ action: state.loading ? 'stop' : 'reload' }));

  ipcRenderer.on(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL, (_event, value) => {
    render(normalizeDesktopWebServiceBrowserState(value));
  });
  void ipcRenderer.invoke(DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL).then((value) => {
    render(normalizeDesktopWebServiceBrowserState(value));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

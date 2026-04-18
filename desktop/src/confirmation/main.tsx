import './index.css';

import { render } from 'solid-js/web';

import { desktopConfirmationActionURL } from '../shared/desktopConfirmationContract';
import { DesktopConfirmationApp } from './App';
import { loadDesktopConfirmationPageState } from './pageState';

function applyResolvedTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
}

function cancelAndClose(): void {
  window.location.href = desktopConfirmationActionURL('cancel');
}

function main(): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  const state = loadDesktopConfirmationPageState(window.location.search);
  applyResolvedTheme(state.resolvedTheme);

  if (!state.model) {
    cancelAndClose();
    return;
  }

  const model = state.model;
  document.title = model.title;
  render(() => <DesktopConfirmationApp model={model} />, root);
}

main();

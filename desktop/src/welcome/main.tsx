import './index.css';

import { render } from 'solid-js/web';

import { DesktopWelcomeShell, loadDesktopWelcomeApp } from './App';

function renderBridgeMissing(root: HTMLElement): void {
  root.innerHTML = `
    <main class="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-5 py-10">
      <section class="w-full rounded-2xl border border-error/30 bg-error/5 p-6">
        <div class="text-sm font-semibold uppercase tracking-[0.16em] text-error">Desktop bridge missing</div>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Redeven Desktop could not open the launcher bridge.</h1>
        <p class="mt-3 text-sm leading-6 text-muted-foreground">Restart Redeven Desktop and try again.</p>
      </section>
    </main>
  `;
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  const props = await loadDesktopWelcomeApp();
  if (!props) {
    renderBridgeMissing(root);
    return;
  }

  render(() => <DesktopWelcomeShell {...props} />, root);
}

void main();

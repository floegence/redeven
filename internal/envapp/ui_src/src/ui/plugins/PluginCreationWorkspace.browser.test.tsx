import '../../index.css';

import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '../i18n';
import { PluginCreationWorkspace } from './PluginCreationWorkspace';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

function mount() {
  const onDeleteProject = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <I18nProvider><PluginCreationWorkspace
    open mode="chat" projectID="project-1" threadID="thread-1"
    onOpenChange={vi.fn()} onModeChange={vi.fn()} onDeleteProject={onDeleteProject}
    renderFlower={() => <div data-testid="flower-surface" />}
  /></I18nProvider>, host);
  return { host, onDeleteProject };
}

it('renders as a full page surface instead of a dialog or drawer', async () => {
  const { host } = mount();
  await expect.element(page.elementLocator(host.querySelector('[data-plugin-creation-page]')!)).toBeVisible();
  expect(host.querySelector('[data-floe-dialog-presentation]')).toBeNull();
  expect(host.querySelector('[data-testid="flower-surface"]')).toBeTruthy();
});

it('requires confirmation before deleting the project', async () => {
  const { host, onDeleteProject } = mount();
  await page.elementLocator(host.querySelector('[data-plugin-creation-page] button')!).click();
  await expect.element(page.getByText('Delete plugin project?')).toBeVisible();
  expect(onDeleteProject).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Delete project' }).last().click();
  expect(onDeleteProject).toHaveBeenCalledTimes(1);
});

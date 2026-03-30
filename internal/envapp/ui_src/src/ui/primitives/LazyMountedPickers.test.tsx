// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LazyMountedDirectoryPicker, LazyMountedFileSavePicker } from './LazyMountedPickers';

const renderCounts = {
  directory: 0,
  fileSave: 0,
};

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  DirectoryPicker: (props: any) => {
    renderCounts.directory += 1;
    return (
      <div
        data-testid="directory-picker"
        data-render-count={String(renderCounts.directory)}
        data-home-path={String(props.homePath ?? '')}
        data-initial-path={String(props.initialPath ?? '')}
      />
    );
  },
  FileSavePicker: (props: any) => {
    renderCounts.fileSave += 1;
    return (
      <div
        data-testid="file-save-picker"
        data-render-count={String(renderCounts.fileSave)}
        data-home-path={String(props.homePath ?? '')}
        data-initial-path={String(props.initialPath ?? '')}
        data-initial-file-name={String(props.initialFileName ?? '')}
      />
    );
  },
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  renderCounts.directory = 0;
  renderCounts.fileSave = 0;
});

describe('LazyMountedPickers', () => {
  it('mounts the directory picker only while open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [open, setOpen] = createSignal(false);
    render(() => (
      <LazyMountedDirectoryPicker
        open={open()}
        onOpenChange={() => {}}
        files={[]}
        initialPath="/project"
        homePath="/Users/demo"
        onSelect={() => {}}
      />
    ), host);

    expect(host.querySelector('[data-testid="directory-picker"]')).toBeNull();

    setOpen(true);
    await flushAsync();

    expect(host.querySelector('[data-testid="directory-picker"]')?.getAttribute('data-render-count')).toBe('1');
  });

  it('mounts the file-save picker only while open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [open, setOpen] = createSignal(false);
    render(() => (
      <LazyMountedFileSavePicker
        open={open()}
        onOpenChange={() => {}}
        files={[]}
        initialPath="/project"
        homePath="/Users/demo"
        initialFileName="notes.txt"
        onSave={() => {}}
      />
    ), host);

    expect(host.querySelector('[data-testid="file-save-picker"]')).toBeNull();

    setOpen(true);
    await flushAsync();

    expect(host.querySelector('[data-testid="file-save-picker"]')?.getAttribute('data-render-count')).toBe('1');
  });
});

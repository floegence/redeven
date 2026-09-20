import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';

const home = '/Users/tangjianyin';
const externalPath = '/Volumes/JianDisk/code/floegence/floebrowser-projection-lifecycle';
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
});

async function mountFiles(homePath: string | undefined = home) {
  const host = document.createElement('div');
  document.body.append(host);
  const submit = vi.fn(async (path: string) => ({ status: 'ready' as const, committedPath: path }));
  const [editRequest, setEditRequest] = createSignal(0);
  cleanups.push(render(() => (
    <FloeConfigProvider>
      <LayoutProvider>
        <div style={{ height: '560px' }}>
          <FileBrowserWorkspace
            mode="files" onModeChange={() => {}} files={[]} currentPath={home} initialPath={home}
            homePath={homePath} instanceId="absolute-path-input" resetKey={0} open={false}
            pathEditRequestKey={editRequest()} onPathSubmit={submit}
          />
        </div>
      </LayoutProvider>
    </FloeConfigProvider>
  ), host));
  setEditRequest(1);
  await vi.waitFor(() => expect(host.querySelector('input[aria-label="Go to path"]')).not.toBeNull());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Go to path"]')!;
  const enter = (value: string) => {
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };
  return { host, input, submit, enter };
}

describe('Files absolute path input', () => {
  it.each([
    [externalPath, externalPath],
    [`${externalPath}/`, externalPath],
    ['/', '/'],
    [home, home],
    [`${home}/project`, `${home}/project`],
    ['/srv/custom-root/project', '/srv/custom-root/project'],
    ['~', home],
    ['~/Documents', `${home}/Documents`],
    [`${home}-other/project`, `${home}-other/project`],
    ['/Volumes/团队磁盘/项目 文件', '/Volumes/团队磁盘/项目 文件'],
    ['/Volumes//JianDisk/./code/../code', '/Volumes/JianDisk/code'],
    ['  /Volumes/JianDisk/  ', '/Volumes/JianDisk'],
  ])('submits %s as the same absolute location used by directory navigation', async (input, expected) => {
    const f = await mountFiles();
    expect(f.input.value).toBe('~');
    f.enter(input);
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledWith(expected));
    expect(f.host.querySelector('input[aria-label="Go to path"]')).toBeNull();
  });

  it.each(['', 'project', '../project', '~\\Documents', '/a\0b'])('rejects invalid input %j without requesting a directory', async (input) => {
    const f = await mountFiles();
    f.enter(input);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.input.getAttribute('aria-invalid')).toBe('true');
    expect(f.host.textContent).toContain('Enter an absolute path, ~, or a path starting with ~/');
    expect(f.input.value).toBe(input);
  });

  it('accepts an absolute path when Home is unavailable', async () => {
    const f = await mountFiles('');
    f.enter(externalPath);
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledWith(externalPath));
  });

  it('explains how to recover when Home is unavailable for a tilde path', async () => {
    const f = await mountFiles('');
    f.enter('~/Documents');
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.host.textContent).toContain('Home directory is unavailable. Enter an absolute path.');
  });

  it.each(['List', 'Grid'])('preserves file identity, absolute paths, and reveal selection in %s view', async (view) => {
    const file: FileItem = { id: 'stable-file-id', name: 'readme.md', type: 'file', path: `${externalPath}/readme.md`, size: 42, extension: 'md' };
    const opened = vi.fn();
    const consumed = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
      <div style={{ height: '560px' }}>
        <FileBrowserWorkspace mode="files" onModeChange={() => {}}
          files={[{ id: 'stable-directory-id', name: 'project', type: 'folder', path: externalPath, children: [file] }]}
          currentPath={externalPath} initialPath={externalPath} homePath={home}
          instanceId="absolute-file-identity" resetKey={0} open={false} onOpen={opened}
          revealRequest={{ requestId: 'reveal-file', targetId: file.id, targetPath: file.path, parentPath: externalPath, clearFilter: 'if-needed' }}
          onRevealRequestConsumed={consumed} />
      </div>
    </LayoutProvider></FloeConfigProvider>, host));
    const viewButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === view)!;
    viewButton.click();
    await vi.waitFor(() => expect(consumed).toHaveBeenCalledWith('reveal-file'));
    const row = host.querySelector<HTMLElement>('[data-file-browser-item-id="stable-file-id"]')!;
    expect(row).not.toBeNull();
    expect(row.dataset.fileBrowserItemPath).toBe(file.path);
    expect(host.textContent).toContain('1 selected');
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(file));
  });
});

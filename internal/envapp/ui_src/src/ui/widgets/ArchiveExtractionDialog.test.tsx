// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { RpcError } from '@floegence/floe-webapp-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchiveExtractionDialog } from './ArchiveExtractionDialog';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      title={props.title}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  DirectoryPicker: (props: any) => (
    <Show when={props.open}>
      <button
        type="button"
        data-testid="directory-picker"
        onClick={() => {
          props.onOpenChange(false);
          props.onSelect('/output');
        }}
      >
        {props.title}
      </button>
    </Show>
  ),
}));

vi.mock('../primitives/EnvAppModal', () => ({
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog">
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function renderDialog(overrides?: Partial<Parameters<typeof ArchiveExtractionDialog>[0]>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onExtract = vi.fn().mockResolvedValue({
    destinationPath: '/workspace/repo/bundle',
    resultKind: 'directory',
    archiveFormat: 'zip',
  });
  const onComplete = vi.fn();
  const onClose = vi.fn();
  const props = {
    open: true,
    request: {
      item: {
        id: '/workspace/repo/bundle.zip',
        name: 'bundle.zip',
        path: '/workspace/repo/bundle.zip',
        type: 'file' as const,
      },
      classification: {
        format: 'zip' as const,
        kind: 'archive' as const,
        defaultOutputName: 'bundle',
      },
      pickerRootPath: '/workspace',
      pickerRootLabel: 'Home',
    },
    listDirectory: vi.fn().mockResolvedValue([]),
    isWritablePath: vi.fn().mockReturnValue(true),
    onExtract,
    onComplete,
    onClose,
    ...overrides,
  };
  const dispose = render(() => <ArchiveExtractionDialog {...props} />, host);
  return { host, props, onExtract, onComplete, onClose, dispose };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ArchiveExtractionDialog', () => {
  it('uses the classified default name and selected destination', async () => {
    const { host, onExtract, onComplete, onClose } = renderDialog();

    expect(host.querySelector<HTMLInputElement>('input:not([type="password"])')?.value).toBe('bundle');
    const browse = host.querySelector<HTMLButtonElement>('[aria-label="Choose destination folder"]');
    browse!.click();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="directory-picker"]')!.click();

    const inputs = host.querySelectorAll<HTMLInputElement>('input:not([type="password"])');
    expect(inputs[1]?.value).toBe('/workspace/output');
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();

    expect(onExtract).toHaveBeenCalledWith({
      sourcePath: '/workspace/repo/bundle.zip',
      destinationParentPath: '/workspace/output',
      destinationName: 'bundle',
    }, { signal: expect.any(AbortSignal) });
    expect(onComplete).toHaveBeenCalledWith({
      destinationPath: '/workspace/repo/bundle',
      resultKind: 'directory',
      archiveFormat: 'zip',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('asks for a password only after password error codes and supports retry', async () => {
    const onExtract = vi.fn()
      .mockRejectedValueOnce(new RpcError({ typeId: 1011, code: 42213, message: 'backend detail' }))
      .mockRejectedValueOnce(new RpcError({ typeId: 1011, code: 42214, message: 'backend detail' }))
      .mockResolvedValueOnce({ destinationPath: '/workspace/repo/secret', resultKind: 'directory', archiveFormat: 'zip' });
    const { host } = renderDialog({ onExtract });

    expect(host.querySelector('input[type="password"]')).toBeNull();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();
    expect(host.textContent).toContain('This archive requires a password.');
    expect(host.textContent).not.toContain('backend detail');

    const passwordInput = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    passwordInput.value = 'wrong';
    passwordInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();
    expect(host.textContent).toContain('The password is incorrect. Try again.');

    passwordInput.value = 'correct';
    passwordInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();
    expect(onExtract).toHaveBeenLastCalledWith(expect.objectContaining({ password: 'correct' }), expect.anything());
  });

  it('aborts extraction but stays open until the request settles', async () => {
    const pending = deferred<{ destinationPath: string; resultKind: 'directory'; archiveFormat: string }>();
    const onExtract = vi.fn().mockReturnValue(pending.promise);
    const { host, onClose } = renderDialog({ onExtract });

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();
    const signal = onExtract.mock.calls[0]?.[1]?.signal as AbortSignal;
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!.click();

    expect(signal.aborted).toBe(true);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('Canceling...');
    expect(onClose).not.toHaveBeenCalled();

    pending.reject(new DOMException('aborted', 'AbortError'));
    await flush();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not offer cancellation after extraction has completed', async () => {
    const completion = deferred<void>();
    const onComplete = vi.fn().mockReturnValue(completion.promise);
    const { host, onClose } = renderDialog({ onComplete });

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!.click();
    await flush();

    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!;
    expect(onComplete).toHaveBeenCalledOnce();
    expect(cancel.disabled).toBe(true);
    cancel.click();
    expect(onClose).not.toHaveBeenCalled();

    completion.resolve();
    await flush();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('explains multipart archives without issuing an extraction request', () => {
    const onExtract = vi.fn();
    const { host } = renderDialog({
      onExtract,
      request: {
        item: { id: '/workspace/bundle.part01.rar', name: 'bundle.part01.rar', path: '/workspace/bundle.part01.rar', type: 'file' },
        classification: { format: 'rar', kind: 'multipart', defaultOutputName: 'bundle' },
        pickerRootPath: '/workspace',
      },
    });

    expect(host.textContent).toContain('Multipart archives are not supported yet.');
    const extract = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Extract')!;
    expect(extract.disabled).toBe(true);
    extract.click();
    expect(onExtract).not.toHaveBeenCalled();
  });
});

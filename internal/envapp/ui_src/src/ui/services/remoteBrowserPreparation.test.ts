import { expect, it, vi } from 'vitest';
import { remoteBrowserPreparation } from '../../../../../flower_ui/host/remoteBrowserPreparation';

const installationID = 'browser-aaaaaaaaaaaaaaaaaaaaaaaa';
const applicationID = 'custom:remote-browser-0123456789abcdef0123456789abcdef.desktop';

it('hands the prepared application to Host Applications without launching or granting a browser target', async () => {
  const request = vi.fn().mockResolvedValue({ id: applicationID });
  const reveal = vi.fn();
  const signal = new AbortController().signal;
  await remoteBrowserPreparation(request, reveal)(installationID, signal);
  expect(request).toHaveBeenCalledExactlyOnceWith('POST', '/_redeven_proxy/api/browser/extension/remote', { installation_id: installationID }, signal);
  expect(reveal).toHaveBeenCalledExactlyOnceWith(applicationID);
});

it('does not navigate after a closed guide receives a late preparation result', async () => {
  let finish!: (value: { id: string }) => void;
  const request = vi.fn(() => new Promise<{ id: string }>(resolve => { finish = resolve; }));
  const reveal = vi.fn();
  const controller = new AbortController();
  const pending = remoteBrowserPreparation(request as never, reveal)(installationID, controller.signal);
  controller.abort(); finish({ id: applicationID });
  await expect(pending).rejects.toThrow();
  expect(reveal).not.toHaveBeenCalled();
});

it('rejects executable paths before preparation', async () => {
  const request = vi.fn(), reveal = vi.fn();
  await expect(remoteBrowserPreparation(request, reveal)('/usr/bin/chromium', new AbortController().signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled(); expect(reveal).not.toHaveBeenCalled();
});

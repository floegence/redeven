import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showSaveDialog = vi.fn();
const showItemInFolder = vi.fn();
const openPath = vi.fn();

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog,
  },
  shell: {
    showItemInFolder,
    openPath,
  },
}));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-download-writer-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.resetModules();
  showSaveDialog.mockReset();
  showItemInFolder.mockReset();
  openPath.mockReset();
  openPath.mockResolvedValue('');
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('DesktopDownloadWriter', () => {
  it('writes chunks to a temp file and renames it on completion', async () => {
    const dir = await makeTempDir();
    const finalPath = path.join(dir, 'report.txt');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: finalPath });
    const { DesktopDownloadWriter } = await import('./desktopDownloadWriter');
    const writer = new DesktopDownloadWriter();

    const prepared = await writer.prepare(null, {
      task_id: 'task-1',
      suggested_name: '../unsafe:report.txt',
      total_bytes: 3,
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.destination?.file_name).toBe('report.txt');
    expect(await fs.stat(`${finalPath}.download.tmp`)).toBeTruthy();

    await writer.write({ token: prepared.destination!.token, chunk: new Uint8Array([65, 66]) });
    await writer.write({ token: prepared.destination!.token, chunk: new Uint8Array([67]).buffer });
    const completed = await writer.complete(prepared.destination!.token);

    expect(completed.ok).toBe(true);
    expect(await fs.readFile(finalPath, 'utf8')).toBe('ABC');
    await expect(fs.stat(`${finalPath}.download.tmp`)).rejects.toThrow();
  });

  it('localizes the save dialog through the current Desktop language', async () => {
    const dir = await makeTempDir();
    const finalPath = path.join(dir, 'report.txt');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: finalPath });
    const { DesktopDownloadWriter } = await import('./desktopDownloadWriter');
    const writer = new DesktopDownloadWriter(() => 'zh-CN');

    await writer.prepare(null, {
      task_id: 'task-localized',
      suggested_name: 'report.txt',
    });

    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '保存下载',
      buttonLabel: '保存',
    }));
  });

  it('localizes desktop-side download action failures', async () => {
    const { DesktopDownloadWriter } = await import('./desktopDownloadWriter');
    const writer = new DesktopDownloadWriter(() => 'zh-CN');

    await expect(writer.reveal('missing-token')).resolves.toMatchObject({
      ok: false,
      message: 'Desktop download 尚未完成。',
    });
  });

  it('cleans up the temp file when aborted', async () => {
    const dir = await makeTempDir();
    const finalPath = path.join(dir, 'cancel.bin');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: finalPath });
    const { DesktopDownloadWriter } = await import('./desktopDownloadWriter');
    const writer = new DesktopDownloadWriter();

    const prepared = await writer.prepare(null, {
      task_id: 'task-2',
      suggested_name: 'cancel.bin',
    });
    await writer.write({ token: prepared.destination!.token, chunk: new Uint8Array([1, 2, 3]) });
    const aborted = await writer.abort({ token: prepared.destination!.token, reason: 'canceled' });

    expect(aborted.ok).toBe(true);
    await expect(fs.stat(`${finalPath}.download.tmp`)).rejects.toThrow();
    await expect(fs.stat(finalPath)).rejects.toThrow();
  });

  it('supports reveal and open only after completion', async () => {
    const dir = await makeTempDir();
    const finalPath = path.join(dir, 'open.txt');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: finalPath });
    const { DesktopDownloadWriter } = await import('./desktopDownloadWriter');
    const writer = new DesktopDownloadWriter();

    const prepared = await writer.prepare(null, {
      task_id: 'task-3',
      suggested_name: 'open.txt',
    });

    expect(await writer.reveal(prepared.destination!.token)).toMatchObject({ ok: false });
    await writer.complete(prepared.destination!.token);

    expect(await writer.reveal(prepared.destination!.token)).toEqual({ ok: true });
    expect(showItemInFolder).toHaveBeenCalledWith(finalPath);
    expect(await writer.open(prepared.destination!.token)).toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(finalPath);
  });
});

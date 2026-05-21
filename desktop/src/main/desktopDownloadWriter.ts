import { dialog, shell, type BrowserWindow, type SaveDialogOptions } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  DesktopDownloadAbortRequest,
  DesktopDownloadActionResponse,
  DesktopDownloadCompleteResponse,
  DesktopDownloadDestination,
  DesktopDownloadPrepareRequest,
  DesktopDownloadPrepareResponse,
  DesktopDownloadWriteRequest,
} from '../shared/desktopDownloadIPC';

type DesktopDownloadRecord = {
  token: string;
  finalPath: string;
  tempPath: string;
  fileName: string;
  handle: fs.FileHandle | null;
  completed: boolean;
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function safeSuggestedFileName(value: string): string {
  const sanitized = Array.from(path.basename(compact(value))).map((character) => {
    const code = character.charCodeAt(0);
    if (code < 32) {
      return '_';
    }
    return /[<>:"/\\|?*]/.test(character) ? '_' : character;
  }).join('');
  const base = sanitized.trim();
  return base || 'download';
}

function destinationFromRecord(record: DesktopDownloadRecord): DesktopDownloadDestination {
  return {
    token: record.token,
    file_name: record.fileName,
    display_path: record.finalPath,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && compact(error.message)) {
    return error.message;
  }
  const raw = compact(error);
  return raw || fallback;
}

export class DesktopDownloadWriter {
  private readonly records = new Map<string, DesktopDownloadRecord>();

  async prepare(
    ownerWindow: BrowserWindow | null,
    request: DesktopDownloadPrepareRequest,
  ): Promise<DesktopDownloadPrepareResponse> {
    const suggestedName = safeSuggestedFileName(request.suggested_name);
    const options: SaveDialogOptions = {
      title: 'Save download',
      defaultPath: suggestedName,
      buttonLabel: 'Save',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { ok: true, canceled: true };
    }

    const finalPath = result.filePath;
    const tempPath = `${finalPath}.download.tmp`;
    const token = crypto.randomUUID();

    try {
      await fs.rm(tempPath, { force: true });
      const handle = await fs.open(tempPath, 'w');
      const record: DesktopDownloadRecord = {
        token,
        finalPath,
        tempPath,
        fileName: path.basename(finalPath),
        handle,
        completed: false,
      };
      this.records.set(token, record);
      return {
        ok: true,
        destination: destinationFromRecord(record),
      };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(error, 'Desktop could not open the destination file.'),
      };
    }
  }

  async write(request: DesktopDownloadWriteRequest): Promise<DesktopDownloadActionResponse> {
    const record = this.records.get(request.token);
    if (!record || record.completed || !record.handle) {
      return {
        ok: false,
        message: 'Desktop download destination is no longer available.',
      };
    }

    try {
      const chunk = request.chunk instanceof Uint8Array
        ? request.chunk
        : new Uint8Array(request.chunk);
      await record.handle.writeFile(Buffer.from(chunk));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(error, 'Desktop could not write to the destination file.'),
      };
    }
  }

  async complete(token: string): Promise<DesktopDownloadCompleteResponse> {
    const record = this.records.get(token);
    if (!record || record.completed || !record.handle) {
      return {
        ok: false,
        message: 'Desktop download destination is no longer available.',
      };
    }

    try {
      await record.handle.close();
      record.handle = null;
      await fs.rename(record.tempPath, record.finalPath);
      record.completed = true;
      return {
        ok: true,
        destination: destinationFromRecord(record),
      };
    } catch (error) {
      await this.abort({ token, reason: 'failed' });
      return {
        ok: false,
        message: errorMessage(error, 'Desktop could not finish the download.'),
      };
    }
  }

  async abort(request: DesktopDownloadAbortRequest): Promise<DesktopDownloadActionResponse> {
    const record = this.records.get(request.token);
    if (!record) {
      return { ok: true };
    }

    try {
      if (record.handle) {
        await record.handle.close();
        record.handle = null;
      }
      if (!record.completed) {
        await fs.rm(record.tempPath, { force: true });
        this.records.delete(record.token);
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: errorMessage(error, 'Desktop could not clean up the canceled download.'),
      };
    }
  }

  async reveal(token: string): Promise<DesktopDownloadActionResponse> {
    const record = this.records.get(token);
    if (!record?.completed) {
      return {
        ok: false,
        message: 'Desktop download is not complete.',
      };
    }
    shell.showItemInFolder(record.finalPath);
    return { ok: true };
  }

  async open(token: string): Promise<DesktopDownloadActionResponse> {
    const record = this.records.get(token);
    if (!record?.completed) {
      return {
        ok: false,
        message: 'Desktop download is not complete.',
      };
    }

    const message = await shell.openPath(record.finalPath);
    if (message) {
      return { ok: false, message };
    }
    return { ok: true };
  }
}

import path from 'node:path';

import type { RuntimeFlowerHTTPResponse } from './runtimeFlowerHTTP';

export const RUNTIME_FLOWER_ATTACHMENT_PREVIEW_MAX_BYTES = 10 << 20;
export const RUNTIME_FLOWER_ATTACHMENT_PREVIEW_RETENTION_MS = 15 * 60_000;

const RUNTIME_FLOWER_ATTACHMENT_PREVIEW_EXTENSIONS = new Map<string, string>([
  ['text/plain', '.txt'],
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

function canonicalRuntimeFlowerAttachmentPreviewMediaType(contentType: string | string[] | undefined): string {
  if (typeof contentType !== 'string') return '';
  const [essence, ...parameters] = contentType.split(';').map((segment) => segment.trim().toLowerCase());
  if (!essence || (parameters.length > 0 && (
    essence !== 'text/plain' || parameters.length !== 1 || parameters[0] !== 'charset=utf-8'
  ))) return '';
  return essence;
}

export function runtimeFlowerAttachmentPreviewFilename(contentType: string | string[] | undefined): string {
  const mediaType = canonicalRuntimeFlowerAttachmentPreviewMediaType(contentType);
  const extension = RUNTIME_FLOWER_ATTACHMENT_PREVIEW_EXTENSIONS.get(mediaType);
  if (!extension) {
    throw new Error('Flower returned an unsupported attachment preview content type.');
  }
  return `attachment-preview${extension}`;
}

export async function requestRuntimeFlowerAttachmentPreviewWithAccess(input: Readonly<{
  request: () => Promise<RuntimeFlowerHTTPResponse>;
  invalidateAccess: () => void;
  refreshAccess: () => Promise<void>;
}>): Promise<RuntimeFlowerHTTPResponse> {
  let response = await input.request();
  if (response.status !== 423) return response;
  input.invalidateAccess();
  await input.refreshAccess();
  response = await input.request();
  return response;
}

export type RuntimeFlowerAttachmentPreviewFileSystem = Readonly<{
  createDirectory: (prefix: string) => Promise<string>;
  writeExclusive: (filePath: string, bytes: Buffer) => Promise<void>;
  removeDirectory: (directoryPath: string) => Promise<void>;
  openPath: (filePath: string) => Promise<string>;
  scheduleCleanup: (cleanup: () => void, delayMS: number) => void;
}>;

export async function materializeRuntimeFlowerAttachmentPreview(input: Readonly<{
  bytes: Buffer;
  contentType: string | string[] | undefined;
  tempRoot: string;
  fileSystem: RuntimeFlowerAttachmentPreviewFileSystem;
}>): Promise<void> {
  if (input.bytes.byteLength > RUNTIME_FLOWER_ATTACHMENT_PREVIEW_MAX_BYTES) {
    throw new Error('This attachment is too large to preview from Desktop.');
  }
  const previewFilename = runtimeFlowerAttachmentPreviewFilename(input.contentType);
  const previewDirectory = await input.fileSystem.createDirectory(
    path.join(input.tempRoot, 'redeven-flower-preview-'),
  );
  const previewPath = path.join(previewDirectory, previewFilename);
  try {
    await input.fileSystem.writeExclusive(previewPath, input.bytes);
    const openError = await input.fileSystem.openPath(previewPath);
    if (openError) throw new Error(openError);
  } catch (error) {
    await input.fileSystem.removeDirectory(previewDirectory);
    throw error;
  }
  input.fileSystem.scheduleCleanup(() => {
    void input.fileSystem.removeDirectory(previewDirectory);
  }, RUNTIME_FLOWER_ATTACHMENT_PREVIEW_RETENTION_MS);
}

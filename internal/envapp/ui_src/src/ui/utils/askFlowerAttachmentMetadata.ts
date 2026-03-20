const attachmentSourcePathByFile = new WeakMap<File, string>();

export function setAskFlowerAttachmentSourcePath(file: File, path: string): File {
  const normalizedPath = String(path ?? '').trim();
  if (normalizedPath) {
    attachmentSourcePathByFile.set(file, normalizedPath);
  }
  return file;
}

export function getAskFlowerAttachmentSourcePath(file: File): string {
  return attachmentSourcePathByFile.get(file) ?? '';
}

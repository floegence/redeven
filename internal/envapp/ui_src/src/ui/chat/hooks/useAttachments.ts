// File attachment management hook for the chat input.

import { createSignal } from 'solid-js';
import type { Attachment, AttachmentType, AttachmentStatus } from '../types';

export type AttachmentUploadMode = 'immediate' | 'deferred';

export interface UseAttachmentsOptions {
  maxAttachments?: number;
  maxSize?: number;
  acceptedTypes?: string;
  onUpload?: (file: File) => Promise<string>;
  uploadMode?: AttachmentUploadMode;
}

export interface UploadAllResult {
  ok: boolean;
  failed: Attachment[];
  attachments: Attachment[];
}

export interface UseAttachmentsReturn {
  attachments: () => Attachment[];
  isDragging: () => boolean;
  hasUploading: () => boolean;
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  uploadAll: () => Promise<UploadAllResult>;
  openFilePicker: () => void;
  handleDragEnter: (e: DragEvent) => void;
  handleDragLeave: (e: DragEvent) => void;
  handleDragOver: (e: DragEvent) => void;
  handleDrop: (e: DragEvent) => void;
  handlePaste: (e: ClipboardEvent) => void;
}

/** Generate a UUID using crypto.randomUUID or a fallback. */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Determine attachment type based on file MIME type. */
function resolveAttachmentType(file: File): AttachmentType {
  return file.type.startsWith('image/') ? 'image' : 'file';
}

/** Create a preview URL for image files. */
function createPreviewUrl(file: File): string | undefined {
  if (file.type.startsWith('image/')) {
    return URL.createObjectURL(file);
  }
  return undefined;
}

/** Check if a file type matches the accepted types string (comma-separated MIME types or extensions). */
function isAcceptedType(file: File, acceptedTypes?: string): boolean {
  if (!acceptedTypes) return true;

  const accepted = acceptedTypes.split(',').map((s) => s.trim().toLowerCase());
  const fileType = file.type.toLowerCase();
  const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();

  return accepted.some((pattern) => {
    // Wildcard MIME (e.g., "image/*")
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return fileType.startsWith(prefix + '/');
    }
    // Exact MIME match
    if (pattern.includes('/')) {
      return fileType === pattern;
    }
    // Extension match (e.g., ".png")
    if (pattern.startsWith('.')) {
      return fileExt === pattern;
    }
    return false;
  });
}

function revokePreview(attachment: Attachment): void {
  if (attachment.preview) {
    URL.revokeObjectURL(attachment.preview);
  }
}

export function useAttachments(options: UseAttachmentsOptions = {}): UseAttachmentsReturn {
  const {
    maxAttachments = 10,
    maxSize = 10_485_760, // 10 MB
    acceptedTypes,
    onUpload,
    uploadMode = 'immediate',
  } = options;

  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);

  // Track nested drag enter/leave events
  let dragCounter = 0;

  // Keep per-attachment upload promises to dedupe retry/upload-all calls.
  const uploadTasks = new Map<string, Promise<void>>();

  const hasUploading = () => attachments().some((attachment) => attachment.status === 'uploading');

  /** Upload a single attachment and update its status. */
  async function uploadAttachment(attachment: Attachment): Promise<void> {
    const id = String(attachment.id ?? '').trim();
    if (!id) return;

    const inFlight = uploadTasks.get(id);
    if (inFlight) {
      await inFlight;
      return;
    }

    const task = (async () => {
      const current = attachments().find((item) => item.id === id);
      if (!current) return;
      if (current.status === 'uploaded') return;

      if (!onUpload) {
        setAttachments((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'error' as AttachmentStatus, error: 'Upload handler unavailable' }
              : item,
          ),
        );
        return;
      }

      // Mark as uploading
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: 'uploading' as AttachmentStatus, uploadProgress: 0, error: undefined }
            : item,
        ),
      );

      try {
        const url = await onUpload(current.file);

        // Mark as uploaded
        setAttachments((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'uploaded' as AttachmentStatus, uploadProgress: 100, url }
              : item,
          ),
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';

        setAttachments((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'error' as AttachmentStatus, error: errorMessage }
              : item,
          ),
        );
      }
    })().finally(() => {
      uploadTasks.delete(id);
    });

    uploadTasks.set(id, task);
    await task;
  }

  /** Upload pending/failed attachments and wait until all uploads finish. */
  async function uploadAll(): Promise<UploadAllResult> {
    const snapshot = attachments();
    const idsToUpload = snapshot
      .filter((attachment) => attachment.status === 'pending' || attachment.status === 'error')
      .map((attachment) => attachment.id);

    for (const id of idsToUpload) {
      const current = attachments().find((item) => item.id === id);
      if (!current) continue;
      await uploadAttachment(current);
    }

    const pendingUploads = attachments()
      .filter((attachment) => attachment.status === 'uploading')
      .map((attachment) => uploadTasks.get(attachment.id))
      .filter((task): task is Promise<void> => !!task);

    if (pendingUploads.length > 0) {
      await Promise.allSettled(pendingUploads);
    }

    const final = attachments();
    const failed = final.filter((attachment) => attachment.status !== 'uploaded');
    return {
      ok: failed.length === 0,
      failed,
      attachments: final,
    };
  }

  /** Add files to the attachment list after validation. */
  function addFiles(files: FileList | File[]): void {
    const fileArr = Array.from(files);
    const current = attachments();
    const remaining = maxAttachments - current.length;

    if (remaining <= 0) return;

    const toAdd = fileArr.slice(0, remaining);
    const newAttachments: Attachment[] = [];

    for (const file of toAdd) {
      // Validate file size
      if (file.size > maxSize) {
        console.warn(`File "${file.name}" exceeds maximum size of ${maxSize} bytes.`);
        continue;
      }

      // Validate file type
      if (!isAcceptedType(file, acceptedTypes)) {
        console.warn(`File "${file.name}" has an unsupported type.`);
        continue;
      }

      const attachment: Attachment = {
        id: generateId(),
        file,
        type: resolveAttachmentType(file),
        preview: createPreviewUrl(file),
        uploadProgress: 0,
        status: 'pending',
      };

      newAttachments.push(attachment);
    }

    if (newAttachments.length === 0) return;

    setAttachments((prev) => [...prev, ...newAttachments]);

    if (uploadMode === 'immediate') {
      // Queue uploads immediately for the legacy flow.
      for (const attachment of newAttachments) {
        void uploadAttachment(attachment);
      }
    }
  }

  /** Remove an attachment by ID. Revokes any preview blob URL. */
  function removeAttachment(id: string): void {
    const removed = attachments().find((attachment) => attachment.id === id);
    if (removed) revokePreview(removed);
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }

  /** Clear all attachments. Revokes all preview blob URLs. */
  function clearAttachments(): void {
    for (const attachment of attachments()) {
      revokePreview(attachment);
    }
    setAttachments([]);
  }

  /** Open the native file picker dialog. */
  function openFilePicker(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (acceptedTypes) {
      input.accept = acceptedTypes;
    }
    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        addFiles(input.files);
      }
    };
    input.click();
  }

  // -- Drag & Drop handlers --

  function handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setIsDragging(false);
    }
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    setIsDragging(false);

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  // -- Paste handler --

  function handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      addFiles(files);
    }
  }

  return {
    attachments,
    isDragging,
    hasUploading,
    addFiles,
    removeAttachment,
    clearAttachments,
    uploadAll,
    openFilePicker,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  };
}

// File attachment management hook for the chat input.

import { createSignal } from 'solid-js';
import type { Attachment, AttachmentType, AttachmentStatus } from '../types';

export interface UseAttachmentsOptions {
  maxAttachments?: number;
  maxSize?: number;
  acceptedTypes?: string;
  onUpload?: (file: File) => Promise<string>;
}

export interface UseAttachmentsReturn {
  attachments: () => Attachment[];
  isDragging: () => boolean;
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
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

export function useAttachments(options: UseAttachmentsOptions = {}): UseAttachmentsReturn {
  const {
    maxAttachments = 10,
    maxSize = 10_485_760, // 10 MB
    acceptedTypes,
    onUpload,
  } = options;

  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);

  // Track nested drag enter/leave events
  let dragCounter = 0;

  /** Upload a single attachment and update its status. */
  async function uploadAttachment(attachment: Attachment): Promise<void> {
    if (!onUpload) return;

    // Mark as uploading
    setAttachments((prev) =>
      prev.map((a) =>
        a.id === attachment.id
          ? { ...a, status: 'uploading' as AttachmentStatus, uploadProgress: 0 }
          : a,
      ),
    );

    try {
      const url = await onUpload(attachment.file);

      // Mark as uploaded
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attachment.id
            ? { ...a, status: 'uploaded' as AttachmentStatus, uploadProgress: 100, url }
            : a,
        ),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attachment.id
            ? { ...a, status: 'error' as AttachmentStatus, error: errorMessage }
            : a,
        ),
      );
    }
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

    // Queue uploads
    for (const att of newAttachments) {
      uploadAttachment(att);
    }
  }

  /** Remove an attachment by ID. Revokes any preview blob URL. */
  function removeAttachment(id: string): void {
    const removed = attachments().find((a) => a.id === id);
    if (removed?.preview) {
      URL.revokeObjectURL(removed.preview);
    }
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  /** Clear all attachments. Revokes all preview blob URLs. */
  function clearAttachments(): void {
    for (const att of attachments()) {
      if (att.preview) {
        URL.revokeObjectURL(att.preview);
      }
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
    addFiles,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  };
}

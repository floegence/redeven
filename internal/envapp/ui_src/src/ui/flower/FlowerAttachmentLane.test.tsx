// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import type { FlowerAttachmentItem } from '../../../../../flower_ui/src/attachments/createFlowerAttachmentController';
import {
  FlowerAttachmentLane,
  type FlowerAttachmentLaneCopy,
} from '../../../../../flower_ui/src/attachments/FlowerAttachmentLane';

const copy: FlowerAttachmentLaneCopy = {
  listLabel: 'Attachments', retry: 'Retry', reselect: 'Select file', cancel: 'Cancel', remove: 'Remove',
  restore: 'Restore', preview: 'Preview', copyReference: 'Copy reference', uploading: 'Uploading',
  queued: 'Queued', ready: 'Ready', failed: 'Failed', incompatible: 'Incompatible',
  reselectRequired: 'Select again', errorTooLarge: 'Too large', errorCountExceeded: 'Too many',
  errorTotalSizeExceeded: 'Total too large', errorUnsupported: 'Unsupported',
  errorInvalidEncoding: 'Invalid encoding', errorUploadFailed: 'Upload failed',
  errorUnavailable: 'Unavailable', lines: (count) => `${count} lines`,
  added: (name) => `${name} added.`, converted: (name) => `${name} converted.`,
  uploaded: (name) => `${name} uploaded.`, uploadFailedAnnouncement: (name) => `${name} failed.`,
};

function uploadingItem(loadedBytes: number): FlowerAttachmentItem {
  return {
    local_id: 'local-1', request_id: 'request-1', attempt_id: 'attempt-1', source: 'file',
    name: 'notes.txt', mime_type: 'text/plain', size_bytes: 100, status: 'uploading',
    loaded_bytes: loadedBytes, total_bytes: 100, progress_indeterminate: false,
  };
}

describe('FlowerAttachmentLane', () => {
  it('shows a ready image as only a thumbnail and remove action while preserving preview and accessible metadata', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const image: FlowerAttachmentItem = {
      ...uploadingItem(100), name: 'diagram.png', mime_type: 'image/png',
      status: 'staged_ready', preview_url: 'blob:diagram',
    };
    const onPreview = vi.fn();
    const onRemove = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[image]} copy={copy} onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()}
        onRemove={onRemove} onRestore={vi.fn()} onPreview={onPreview}
      />
    ), host);
    try {
      const item = host.querySelector('[role="listitem"]')!;
      expect(item.querySelector('.flower-attachment-name')).toBeNull();
      expect(item.querySelector('.flower-attachment-meta')).toBeNull();
      expect(item.querySelector('.flower-attachment-feedback')).toBeNull();
      expect(item.textContent).toBe('');
      expect(item.querySelector('img')?.getAttribute('src')).toBe('blob:diagram');
      expect(item.getAttribute('aria-label')).toBe('diagram.png, 100 B, image/png, Ready');
      expect(item.querySelectorAll('button')).toHaveLength(2);
      (item.querySelector('button[aria-label="Preview: diagram.png"]') as HTMLButtonElement).click();
      expect(onPreview).toHaveBeenCalledWith(image);
      (item.querySelector('button[aria-label="Remove"]') as HTMLButtonElement).click();
      expect(onRemove).toHaveBeenCalledWith(image.local_id);
      expect(onPreview).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps attachment action focus across progress snapshots', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([uploadingItem(1)]);
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={items()}
        copy={copy}
        onRetry={vi.fn()}
        onReselect={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onRestore={vi.fn()}
      />
    ), host);
    try {
      const remove = host.querySelector('button[aria-label="Remove"]') as HTMLButtonElement;
      remove.focus();
      expect(document.activeElement).toBe(remove);
      setItems([uploadingItem(50)]);
      expect(host.querySelector('button[aria-label="Remove"]')).toBe(remove);
      expect(document.activeElement).toBe(remove);
      expect((host.querySelector('progress') as HTMLProgressElement).value).toBe(50);
    } finally {
      dispose();
      host.remove();
    }
  });

  it.each(['queued', 'uploading'] as const)('uses one X to cancel a %s file attachment', (status) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCancel = vi.fn();
    const onRemove = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[{ ...uploadingItem(1), status }]} copy={copy}
        onRetry={vi.fn()} onReselect={vi.fn()} onCancel={onCancel}
        onRemove={onRemove} onRestore={vi.fn()}
      />
    ), host);
    try {
      expect(host.querySelectorAll('button')).toHaveLength(1);
      (host.querySelector('button[aria-label="Remove"]') as HTMLButtonElement).click();
      expect(onCancel).toHaveBeenCalledWith('local-1');
      expect(onRemove).not.toHaveBeenCalled();
    } finally {
      dispose(); host.remove();
    }
  });

  it('keeps image upload progress and retry accessible without adding a second dismiss action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const image: FlowerAttachmentItem = {
      ...uploadingItem(25), name: 'diagram.png', mime_type: 'image/png', preview_url: 'blob:diagram',
    };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([image]);
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={items()} copy={copy} onRetry={onRetry} onReselect={vi.fn()} onCancel={onCancel}
        onRemove={onRemove} onRestore={vi.fn()} onPreview={vi.fn()}
      />
    ), host);
    try {
      const remove = host.querySelector('button[aria-label="Remove"]') as HTMLButtonElement;
      remove.focus();
      expect(host.querySelector('button[aria-label="Cancel"]')).toBeNull();
      expect((host.querySelector('progress') as HTMLProgressElement).value).toBe(25);
      setItems([{ ...image, loaded_bytes: 75 }]);
      expect(document.activeElement).toBe(remove);
      expect((host.querySelector('progress') as HTMLProgressElement).value).toBe(75);
      remove.click();
      expect(onCancel).toHaveBeenCalledWith(image.local_id);
      expect(onRemove).not.toHaveBeenCalled();
      setItems([{ ...image, status: 'upload_error', error_code: 'attachment_upload_failed' }]);
      expect(host.querySelector('.flower-attachment-error')?.textContent).toBe('Upload failed');
      expect(host.querySelector('[role="listitem"]')?.getAttribute('aria-describedby')).toBe('flower-attachment-error-local-1');
      (host.querySelector('button[aria-label="Retry"]') as HTMLButtonElement).click();
      expect(onRetry).toHaveBeenCalledWith(image.local_id);
      setItems([{ ...image, status: 'staged_ready' }]);
      expect(host.querySelector('.flower-attachment-feedback')).toBeNull();
      expect(host.querySelector('button[aria-label="Retry"]')).toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps the thumbnail placeholder and disabled controls after an image fails to load', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const image: FlowerAttachmentItem = {
      ...uploadingItem(100), name: 'diagram.png', mime_type: 'image/png',
      status: 'staged_ready', preview_url: 'blob:diagram',
    };
    const onPreview = vi.fn();
    const onRemove = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[image]} copy={copy} disabled onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()}
        onRemove={onRemove} onRestore={vi.fn()} onPreview={onPreview}
      />
    ), host);
    try {
      host.querySelector('img')!.dispatchEvent(new Event('error'));
      expect(host.querySelector('.flower-attachment-image-thumb')).not.toBeNull();
      expect(host.querySelector('.flower-attachment-image-placeholder')).not.toBeNull();
      expect(host.querySelector('.flower-attachment-name')).toBeNull();
      for (const button of host.querySelectorAll('button')) {
        expect(button.disabled).toBe(true);
        button.click();
      }
      expect(onPreview).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('moves focus to the remaining image and then back to the composer after removal', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const image: FlowerAttachmentItem = {
      ...uploadingItem(100), name: 'diagram.png', mime_type: 'image/png', status: 'staged_ready',
    };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([
      image, { ...image, local_id: 'local-2' },
    ]);
    const onFocusFallback = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={items()} copy={copy} onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()}
        onRemove={(id) => setItems((current) => current.filter((item) => item.local_id !== id))}
        onRestore={vi.fn()} onFocusFallback={onFocusFallback}
      />
    ), host);
    try {
      (host.querySelector('button[aria-label="Remove"]') as HTMLButtonElement).click();
      await Promise.resolve();
      const remaining = host.querySelector('button[aria-label="Remove"]') as HTMLButtonElement;
      expect(document.activeElement).toBe(remaining);
      remaining.click();
      await Promise.resolve();
      expect(onFocusFallback).toHaveBeenCalledOnce();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('shows only the ready filename while retaining accessible metadata and lifecycle announcements', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ready: FlowerAttachmentItem = {
      ...uploadingItem(100),
      status: 'staged_ready',
      text_stats: { code_points: 42, lines: 3 },
    };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([uploadingItem(1)]);
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={items()}
        copy={copy}
        onRetry={vi.fn()}
        onReselect={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onRestore={vi.fn()}
      />
    ), host);
    try {
      expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('notes.txt added.');
      setItems([ready]);
      expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('notes.txt uploaded.');
      expect(host.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toBe(
        'notes.txt, 100 B, 3 lines, text/plain, Ready',
      );
      const item = host.querySelector('[role="listitem"]')!;
      expect(item.textContent).toBe('notes.txt');
      expect(item.querySelector('.flower-attachment-meta')).toBeNull();
      expect(item.querySelector('.flower-attachment-feedback')).toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('recreates the polite live region when the same upload failure repeats', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const failed: FlowerAttachmentItem = {
      ...uploadingItem(100), status: 'upload_error', error_code: 'attachment_upload_failed',
    };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([uploadingItem(1)]);
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={items()} copy={copy} onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()}
        onRemove={vi.fn()} onRestore={vi.fn()}
      />
    ), host);
    try {
      setItems([failed]);
      const liveOwners = () => host.querySelectorAll('[aria-live], [role="alert"]');
      const firstID = host.querySelector('[role="status"]')?.getAttribute('data-announcement-id');
      expect(liveOwners()).toHaveLength(1);
      expect(host.querySelector('[role="status"]')?.textContent).toBe('notes.txt failed.');
      expect(host.querySelector('.flower-attachment-error')?.getAttribute('role')).toBeNull();
      setItems([uploadingItem(1)]);
      setItems([failed]);
      const secondID = host.querySelector('[role="status"]')?.getAttribute('data-announcement-id');
      expect(secondID).not.toBe(firstID);
      expect(liveOwners()).toHaveLength(1);
      expect(host.querySelector('[role="status"]')?.textContent).toBe('notes.txt failed.');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('announces an initial validation failure through only the lifecycle live region', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const failed: FlowerAttachmentItem = {
      ...uploadingItem(0), status: 'validation_error', error_code: 'attachment_too_large',
    };
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[failed]} copy={copy} onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()}
        onRemove={vi.fn()} onRestore={vi.fn()}
      />
    ), host);
    try {
      expect(host.querySelectorAll('[aria-live], [role="alert"]')).toHaveLength(1);
      expect(host.querySelector('[role="status"]')?.textContent).toBe('notes.txt failed.');
      expect(host.querySelector('.flower-attachment-error')?.textContent).toBe('Too large');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('exposes reselect as an icon action with a complete accessible name and native keyboard behavior', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onReselect = vi.fn();
    const reselectRequired: FlowerAttachmentItem = {
      ...uploadingItem(0),
      status: 'reselect_required',
    };
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[reselectRequired]} copy={copy} onRetry={vi.fn()} onReselect={onReselect}
        onCancel={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()}
      />
    ), host);
    try {
      const reselect = host.querySelector('button[aria-label="Select file"]') as HTMLButtonElement;
      expect(reselect).not.toBeNull();
      expect(reselect.className).toBe('flower-attachment-icon-button');
      expect(reselect.title).toBe('Select file');
      expect(reselect.textContent).toBe('');
      reselect.focus();
      expect(document.activeElement).toBe(reselect);
      reselect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      reselect.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      reselect.click();
      expect(onReselect).toHaveBeenCalledWith('local-1');
    } finally {
      dispose();
      host.remove();
    }
  });
});

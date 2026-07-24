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
      const cancel = host.querySelector('button[aria-label="Cancel"]') as HTMLButtonElement;
      cancel.focus();
      expect(document.activeElement).toBe(cancel);
      setItems([uploadingItem(50)]);
      expect(host.querySelector('button[aria-label="Cancel"]')).toBe(cancel);
      expect(document.activeElement).toBe(cancel);
      expect((host.querySelector('progress') as HTMLProgressElement).value).toBe(50);
    } finally {
      dispose();
      host.remove();
    }
  });

  it('exposes complete file metadata and polite lifecycle announcements', () => {
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

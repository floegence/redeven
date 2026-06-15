import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopFlowerHostFileActionOpenRequest,
} from './flowerHostSettingsIPC';

describe('flowerHostSettingsIPC', () => {
  it('normalizes Flower Host file action open requests', () => {
    expect(normalizeDesktopFlowerHostFileActionOpenRequest({
      action: 'preview',
      thread_id: ' thread-1 ',
      message_id: ' msg-1 ',
      block_index: 2,
      item_id: ' tool-read ',
      action_id: ' read-app ',
    })).toEqual({
      action: 'preview',
      thread_id: 'thread-1',
      message_id: 'msg-1',
      block_index: 2,
      item_id: 'tool-read',
      action_id: 'read-app',
    });
    expect(normalizeDesktopFlowerHostFileActionOpenRequest({
      action: 'browse_directory',
      message_id: 'msg-1',
      block_index: 0,
      item_id: 'tool-read',
      action_id: 'read-app',
    })).toEqual({
      action: 'browse_directory',
      message_id: 'msg-1',
      block_index: 0,
      item_id: 'tool-read',
      action_id: 'read-app',
    });
    expect(normalizeDesktopFlowerHostFileActionOpenRequest({ action: 'preview', message_id: '', block_index: 0, item_id: 'tool', action_id: 'action' })).toBeNull();
    expect(normalizeDesktopFlowerHostFileActionOpenRequest({ action: 'open', message_id: 'msg', block_index: 0, item_id: 'tool', action_id: 'action' })).toBeNull();
    expect(normalizeDesktopFlowerHostFileActionOpenRequest(null)).toBeNull();
  });
});

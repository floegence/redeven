import { describe, expect, it } from 'vitest';

import {
  mapContextUsage,
  mapFlowerActivityItem,
  mapFlowerThread,
  mergeFlowerContextUsage,
} from './flowerLiveMapper';

describe('Flower context usage contract', () => {
  it('maps canonical thread token totals without changing current context usage', () => {
    expect(mapContextUsage({
      phase: 'provider_usage',
      pressure_status: 'stable',
      input_tokens: 900,
      context_window_tokens: 1000,
      used_ratio: 0.9,
      updated_at_ms: 10,
      thread_usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_read_tokens: 45,
        cache_write_tokens: 5,
      },
    })).toMatchObject({
      input_tokens: 900,
      used_ratio: 0.9,
      thread_usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_read_tokens: 45,
        cache_write_tokens: 5,
      },
    });
  });

  it('rejects malformed canonical thread token totals', () => {
    expect(() => mapContextUsage({
      phase: 'provider_usage',
      pressure_status: 'stable',
      updated_at_ms: 10,
      thread_usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_tokens: -1,
        cache_write_tokens: 0,
      },
    })).toThrow('context_usage.thread_usage.cache_read_tokens must be a non-negative integer');
  });

  it('keeps the latest confirmed totals when a live adjunct omits them', () => {
    const previous = mapContextUsage({
      phase: 'provider_usage',
      pressure_status: 'stable',
      input_tokens: 800,
      updated_at_ms: 10,
      thread_usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_tokens: 90,
        cache_write_tokens: 0,
      },
    })!;
    const incoming = mapContextUsage({
      phase: 'projected_request',
      pressure_status: 'stable',
      input_tokens: 950,
      updated_at_ms: 11,
    })!;

    expect(mergeFlowerContextUsage(previous, incoming)).toEqual({
      ...incoming,
      thread_usage: previous.thread_usage,
    });
  });

  it('accepts an explicitly empty previous context snapshot', () => {
    const incoming = mapContextUsage({
      phase: 'projected_request',
      pressure_status: 'stable',
      input_tokens: 950,
      updated_at_ms: 11,
    })!;

    expect(mergeFlowerContextUsage(null, incoming)).toBe(incoming);
  });

  it('replaces confirmed totals when a newer canonical snapshot includes them', () => {
    const previous = mapContextUsage({
      phase: 'provider_usage',
      pressure_status: 'stable',
      updated_at_ms: 10,
      thread_usage: { input_tokens: 10, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
    })!;
    const incoming = mapContextUsage({
      phase: 'provider_usage',
      pressure_status: 'stable',
      updated_at_ms: 11,
      thread_usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 90, cache_write_tokens: 0 },
    })!;

    expect(mergeFlowerContextUsage(previous, incoming)).toBe(incoming);
  });
});

describe('mapFlowerThread title contract', () => {
  it('rejects a non-empty title without a canonical title status', () => {
    expect(() => mapFlowerThread({
      thread_id: 'thread-invalid-title',
      title: 'Canonical title',
      title_status: '',
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      run_status: 'idle',
      queued_turn_count: 0,
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    })).toThrow('title_status may be empty only when title is empty');
  });

  it('maps the product settings revision independently from runtime activity', () => {
    const mapped = mapFlowerThread({
      thread_id: 'thread-settings-revision',
      title: '',
      title_status: '',
      model_id: 'openai/gpt-5-mini',
      working_dir: '/',
      permission_type: 'full_access',
      settings_revision: 42,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 9,
      run_status: 'running',
      queued_turn_count: 0,
      read_status: {
        is_unread: false,
        snapshot: {
          activity_revision: 9,
          last_message_at_unix_ms: 9,
          activity_signature: 'running',
        },
        read_state: {
          last_seen_activity_revision: 9,
          last_read_message_at_unix_ms: 9,
          last_seen_activity_signature: 'running',
        },
      },
    }, [], {
      runtimeID: 'runtime-test',
      runtimeKind: 'local_environment',
      sourceLabel: 'Local',
      targetLabels: [],
    });

    expect(mapped.settings_revision).toBe(42);
    expect(mapped.permission_type).toBe('full_access');
  });
});

describe('mapFlowerActivityItem structured rows contract', () => {
  const activity = (rows: unknown) => ({
    item_id: 'activity-okf',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    presentation: {
      label: 'OKF search',
      renderer: 'structured',
      payload: { rows },
    },
  });

  it('maps typed rows without exposing another payload shape', () => {
    expect(mapFlowerActivityItem(activity([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]))?.payload?.rows).toEqual([{
      title: 'Flower runtime',
      meta: 'Architecture',
      content: 'One current view.',
      format: 'markdown',
    }]);
  });

  it('rejects unknown row fields and unsupported formats', () => {
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'text', internal_id: 'private' }])))
      .toThrow('internal_id is not part of the structured activity row contract');
    expect(() => mapFlowerActivityItem(activity([{ title: 'Unsafe', format: 'json' }])))
      .toThrow('format is unsupported');
  });

  it('rejects empty rows and an oversized row list', () => {
    expect(() => mapFlowerActivityItem(activity([{ format: 'text' }])))
      .toThrow('must contain display content');
    expect(() => mapFlowerActivityItem(activity(Array.from({ length: 201 }, () => ({ title: 'row', format: 'text' })))))
      .toThrow('exceeds 200 rows');
  });
});

describe('mapFlowerActivityItem web fetch contract', () => {
  it('preserves the dedicated renderer, preview, and passive site icon', () => {
    const mapped = mapFlowerActivityItem({
      item_id: 'activity-web-fetch',
      tool_name: 'web_fetch',
      kind: 'tool',
      status: 'success',
      severity: 'quiet',
      presentation: {
        label: 'Fetch web page',
        renderer: 'web_fetch',
        payload: {
          url: 'https://example.test/start',
          final_url: 'https://example.test/final',
          status_code: 200,
          content_type: 'text/html',
          format: 'markdown',
          content_preview: '# Preview',
          preview_truncated: true,
          site_icon: { content_type: 'image/png', data: 'iVBORw0KGgo=' },
          bytes_read: 512,
          truncated: false,
        },
      },
    });

    expect(mapped?.renderer).toBe('web_fetch');
    expect(mapped?.payload).toMatchObject({
      final_url: 'https://example.test/final',
      status_code: 200,
      content_preview: '# Preview',
      preview_truncated: true,
      site_icon: { content_type: 'image/png', data: 'iVBORw0KGgo=' },
      bytes_read: 512,
    });
  });

  it.each([
    { name: 'unknown payload field', payload: { content: 'full body' }, message: 'is not part of the Web Fetch contract' },
    { name: 'active icon MIME', payload: { site_icon: { content_type: 'image/svg+xml', data: 'PHN2Zy8+' } }, message: 'content_type is unsupported' },
    { name: 'malformed Base64', payload: { site_icon: { content_type: 'image/png', data: 'not base64' } }, message: 'must be canonical Base64' },
    { name: 'spoofed PNG', payload: { site_icon: { content_type: 'image/png', data: 'PHN2Zy8+' } }, message: 'does not match its content type' },
    { name: 'oversized preview', payload: { content_preview: '界'.repeat(2_001) }, message: 'exceeds 2000 characters' },
    { name: 'invalid preview flag', payload: { preview_truncated: 'true' }, message: 'must be a boolean' },
  ])('rejects $name', ({ payload, message }) => {
    expect(() => mapFlowerActivityItem({
      item_id: 'activity-web-fetch-invalid',
      tool_name: 'web_fetch',
      kind: 'tool',
      status: 'success',
      severity: 'quiet',
      presentation: { renderer: 'web_fetch', payload },
    })).toThrow(message);
  });
});

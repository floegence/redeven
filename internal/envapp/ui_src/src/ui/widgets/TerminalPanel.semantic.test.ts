// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { RedevenTerminalTransport } from '../services/terminalTransport';
import {
  clearSemanticTerminalContent,
  resolvePendingTerminalSessions,
  resolveSystemTerminalThemeColors,
} from './TerminalPanel';
import { resolveSemanticTerminalLinkAtPoint } from './semanticTerminalViewport';

const transport = (clearSemanticContent?: RedevenTerminalTransport['clearSemanticContent']) => ({
  attach: vi.fn(),
  attachWithPresentation: vi.fn(),
  resize: vi.fn(),
  resizeWithEffectiveGeometry: vi.fn(),
  sendInput: vi.fn(),
  sendInputIntent: vi.fn(),
  semanticHistory: vi.fn(),
  clearSemanticContent,
  forgetSession: vi.fn(),
  syncConnectionEpoch: vi.fn(),
  dispose: vi.fn(),
}) as unknown as RedevenTerminalTransport;

describe('TerminalPanel semantic contracts', () => {
  it('clears through the actor-owned semantic control exactly once', async () => {
    const clear = vi.fn(async () => ({ presentationSequence: 19, contentEpoch: 4 }));
    await expect(clearSemanticTerminalContent(transport(clear), ' session-1 ')).resolves.toEqual({
      presentationSequence: 19,
      contentEpoch: 4,
    });
    expect(clear).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith('session-1');
  });

  it('fails closed instead of simulating clear in the renderer', async () => {
    await expect(clearSemanticTerminalContent(transport(undefined), 'session-1')).rejects.toThrow(
      'Semantic terminal clear is unavailable',
    );
  });

  it('keeps pending session correlation deterministic', () => {
    const result = resolvePendingTerminalSessions(
      [{
        id: 'pending-1',
        operationSequence: 1,
        createdAtMs: 10,
        name: 'Terminal',
        workingDir: '/workspace',
        visibleSessionIdsAtCreate: [],
        status: 'creating',
      }],
      [{
        id: 'session-1',
        name: 'Terminal',
        workingDir: '/workspace',
        createdAtMs: 11,
        lastActiveAtMs: 11,
        isActive: true,
      }],
      new Set(),
    );
    expect(result).toEqual([expect.objectContaining({
      pendingSessionId: 'pending-1',
      sessionId: 'session-1',
    })]);
  });

  it('lets view-local theme defaults change without replacing explicit ANSI colors', () => {
    const colors = resolveSystemTerminalThemeColors(
      {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: '#333333',
        selectionForeground: '#ffffff',
        red: '#ff0000',
      } as any,
      { '--terminal-background': '#fafafa', '--terminal-foreground': '#101010' },
    );
    expect(colors.background).toBe('#fafafa');
    expect(colors.foreground).toBe('#101010');
    expect(colors.red).toBe('#ff0000');
  });

  it('activates only safe OSC8 URLs and capability-resolved file cells', () => {
    const frame = {
      width: 4,
      height: 1,
      bufferKind: 'normal',
      rows: [{ cells: [
        { text: 'A', width: 1, hyperlink: 'https://example.com/docs' },
        { text: ' ', width: 1 },
        { text: './a.ts', width: 1 },
        { text: '', width: 0 },
      ] }],
      cursor: { x: 0, y: 0, visible: true, shape: 'block', blinking: false },
      history: { revision: 1, totalRows: 1, screenStartOffset: 0 },
      graphics: { generation: 0, images: [], placements: [] },
    } as any;
    const point = (clientX: number) => ({
      clientX,
      clientY: 5,
      bounds: { left: 0, top: 0, width: 40, height: 10 },
      workingDirAbs: '/workspace',
    });

    expect(resolveSemanticTerminalLinkAtPoint(frame, point(5))).toEqual({
      kind: 'external',
      url: 'https://example.com/docs',
    });
    expect(resolveSemanticTerminalLinkAtPoint(frame, point(25))).toEqual({
      kind: 'file',
      target: {
        rawText: './a.ts',
        resolvedPath: '/workspace/a.ts',
      },
    });
    frame.rows[0].cells[0].hyperlink = 'javascript:alert(1)';
    expect(resolveSemanticTerminalLinkAtPoint(frame, point(5))).toBeNull();
  });
});

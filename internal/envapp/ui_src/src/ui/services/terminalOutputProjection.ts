import type { TerminalOutputPipelineChunk } from '@floegence/floeterm-terminal-web';

import {
  TerminalShellIntegrationParser,
  type TerminalShellIntegrationEvent,
} from './terminalShellIntegration';

export type TerminalOutputSource = 'history' | 'live';
export type TerminalOutputChunkWithSource = TerminalOutputPipelineChunk & Readonly<{
  source: TerminalOutputSource;
}>;

export function tagTerminalOutputChunk(
  chunk: TerminalOutputPipelineChunk,
  source: TerminalOutputSource,
): TerminalOutputChunkWithSource {
  return { ...chunk, source };
}

export function createTerminalOutputProjection(options: Readonly<{
  onShellIntegrationEvent?: (event: TerminalShellIntegrationEvent, source: TerminalOutputSource) => void;
  onVisibleOutput?: (source: TerminalOutputSource, byteLength: number) => void;
}>) {
  const parser = new TerminalShellIntegrationParser();

  return {
    transformChunk(chunk: TerminalOutputPipelineChunk): Uint8Array {
      const source = (chunk as Partial<TerminalOutputChunkWithSource>).source === 'history' ? 'history' : 'live';
      const result = parser.parse(chunk.data);
      for (const event of result.events) {
        options.onShellIntegrationEvent?.(event, source);
      }
      if (result.displayData.byteLength > 0) {
        options.onVisibleOutput?.(source, result.displayData.byteLength);
      }
      return result.displayData;
    },
    reset(): void {
      parser.reset();
    },
  };
}

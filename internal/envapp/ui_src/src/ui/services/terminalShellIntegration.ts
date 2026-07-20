import {
  TerminalShellIntegrationParser as FloetermShellIntegrationParser,
  type TerminalShellIntegrationEvent as FloetermShellIntegrationEvent,
} from '@floegence/floeterm-terminal-web';

export type TerminalShellIntegrationEvent =
  | Exclude<FloetermShellIntegrationEvent, { kind: 'command-finished' }>
  | { kind: 'command-finish'; exitCode: number | null }
  | { kind: 'program-activity'; phase: 'busy' | 'idle' };

export type TerminalShellIntegrationParseResult = {
  displayData: Uint8Array;
  events: TerminalShellIntegrationEvent[];
};

type RedevenActivityToken =
  | { kind: 'data'; data: Uint8Array }
  | { kind: 'event'; event: TerminalShellIntegrationEvent };

const ESC = 0x1b;
const OSC = 0x5d;
const BEL = 0x07;
const ST = 0x5c;
const MAX_PENDING_BYTES = 4096;
const REDEVEN_ACTIVITY_PREFIX = '633;P;RedevenActivity=';

/**
 * Delegates the host-neutral shell protocol to Floeterm and only retains the
 * Redeven-specific activity extension used by the Workbench activity border.
 */
export class TerminalShellIntegrationParser {
  private readonly floeterm = new FloetermShellIntegrationParser();
  private readonly redevenActivity = new RedevenActivityParser();

  parse(chunk: Uint8Array): TerminalShellIntegrationParseResult {
    const displaySegments: Uint8Array[] = [];
    const events: TerminalShellIntegrationEvent[] = [];
    for (const token of this.redevenActivity.parse(chunk)) {
      if (token.kind === 'event') {
        events.push(token.event);
        continue;
      }
      const upstream = this.floeterm.parse(token.data);
      if (upstream.displayData.byteLength > 0) displaySegments.push(upstream.displayData);
      events.push(...upstream.events.map(mapFloetermEvent));
    }
    return {
      displayData: concatSegments(displaySegments),
      events,
    };
  }

  reset(): void {
    this.floeterm.reset();
    this.redevenActivity.reset();
  }
}

function mapFloetermEvent(event: FloetermShellIntegrationEvent): TerminalShellIntegrationEvent {
  return event.kind === 'command-finished'
    ? { kind: 'command-finish', exitCode: event.exitCode }
    : event;
}

class RedevenActivityParser {
  private pending = new Uint8Array(0);

  parse(chunk: Uint8Array): RedevenActivityToken[] {
    const data = concatUint8Arrays(this.pending, chunk);
    const tokens: RedevenActivityToken[] = [];
    this.pending = new Uint8Array(0);

    let segmentStart = 0;
    let index = 0;
    while (index < data.length) {
      const start = findOscStart(data, index);
      if (start < 0) {
        if (data.byteLength > segmentStart && data[data.byteLength - 1] === ESC) {
          appendDataToken(tokens, data.subarray(segmentStart, data.byteLength - 1));
          this.pending = data.subarray(data.byteLength - 1).slice();
        } else {
          appendDataToken(tokens, data.subarray(segmentStart));
        }
        return tokens;
      }
      const terminator = findOscTerminator(data, start + 2);
      if (!terminator) {
        const fragment = data.subarray(start);
        if (fragment.byteLength <= MAX_PENDING_BYTES) {
          appendDataToken(tokens, data.subarray(segmentStart, start));
          this.pending = fragment.slice();
        } else {
          appendDataToken(tokens, data.subarray(segmentStart));
        }
        return tokens;
      }

      const event = parseRedevenActivity(data.subarray(start + 2, terminator.payloadEnd));
      if (event) {
        appendDataToken(tokens, data.subarray(segmentStart, start));
        tokens.push({ kind: 'event', event });
        segmentStart = terminator.nextIndex;
      }
      index = terminator.nextIndex;
    }

    appendDataToken(tokens, data.subarray(segmentStart));
    return tokens;
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}

function parseRedevenActivity(payload: Uint8Array): TerminalShellIntegrationEvent | null {
  const text = decodeAscii(payload);
  if (text === `${REDEVEN_ACTIVITY_PREFIX}busy`) {
    return { kind: 'program-activity', phase: 'busy' };
  }
  if (text === `${REDEVEN_ACTIVITY_PREFIX}idle`) {
    return { kind: 'program-activity', phase: 'idle' };
  }
  return null;
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function appendDataToken(target: RedevenActivityToken[], data: Uint8Array): void {
  if (data.byteLength > 0) target.push({ kind: 'data', data });
}

function concatSegments(segments: Uint8Array[]): Uint8Array {
  if (segments.length === 0) return new Uint8Array(0);
  if (segments.length === 1) return segments[0]!;
  const byteLength = segments.reduce((total, segment) => total + segment.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const segment of segments) {
    result.set(segment, offset);
    offset += segment.byteLength;
  }
  return result;
}

function findOscTerminator(data: Uint8Array, start: number): { payloadEnd: number; nextIndex: number } | null {
  for (let index = start; index < data.length; index += 1) {
    if (data[index] === BEL) return { payloadEnd: index, nextIndex: index + 1 };
    if (data[index] === ESC) {
      if (index + 1 >= data.length) return null;
      if (data[index + 1] === ST) return { payloadEnd: index, nextIndex: index + 2 };
    }
  }
  return null;
}

function findOscStart(data: Uint8Array, start: number): number {
  let index = data.indexOf(ESC, start);
  while (index >= 0) {
    if (index + 1 < data.byteLength && data[index + 1] === OSC) return index;
    index = data.indexOf(ESC, index + 1);
  }
  return -1;
}

function decodeAscii(payload: Uint8Array): string {
  let text = '';
  for (const value of payload) text += String.fromCharCode(value);
  return text;
}

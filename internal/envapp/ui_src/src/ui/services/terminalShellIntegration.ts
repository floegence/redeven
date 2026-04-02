export type TerminalShellIntegrationEvent =
  | { kind: 'prompt-ready' }
  | { kind: 'command-start' }
  | { kind: 'command-finish'; exitCode: number | null }
  | { kind: 'program-activity'; phase: 'busy' | 'idle' };

export type TerminalShellIntegrationParseResult = {
  displayData: Uint8Array;
  events: TerminalShellIntegrationEvent[];
};

const ESC = 0x1b;
const OSC = 0x5d;
const BEL = 0x07;
const ST = 0x5c;
const OSC_633_PREFIX = '633;';
const OSC_133_PREFIX = '133;';

export class TerminalShellIntegrationParser {
  private pending = new Uint8Array(0);

  parse(chunk: Uint8Array): TerminalShellIntegrationParseResult {
    const data = concatUint8Arrays(this.pending, chunk);
    const displayBytes: number[] = [];
    const events: TerminalShellIntegrationEvent[] = [];

    let index = 0;
    while (index < data.length) {
      if (data[index] === ESC && index + 1 < data.length && data[index + 1] === OSC) {
        const terminator = findOscTerminator(data, index + 2);
        if (!terminator) {
          break;
        }

        const payload = data.subarray(index + 2, terminator.payloadEnd);
        const event = parseShellIntegrationPayload(payload);
        if (event) {
          events.push(event);
          index = terminator.nextIndex;
          continue;
        }

        for (let cursor = index; cursor < terminator.nextIndex; cursor += 1) {
          displayBytes.push(data[cursor]!);
        }
        index = terminator.nextIndex;
        continue;
      }

      displayBytes.push(data[index]!);
      index += 1;
    }

    this.pending = data.slice(index);

    return {
      displayData: Uint8Array.from(displayBytes),
      events,
    };
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;

  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function findOscTerminator(data: Uint8Array, start: number): { payloadEnd: number; nextIndex: number } | null {
  for (let index = start; index < data.length; index += 1) {
    if (data[index] === BEL) {
      return {
        payloadEnd: index,
        nextIndex: index + 1,
      };
    }
    if (data[index] === ESC) {
      if (index + 1 >= data.length) {
        return null;
      }
      if (data[index + 1] === ST) {
        return {
          payloadEnd: index,
          nextIndex: index + 2,
        };
      }
    }
  }
  return null;
}

function parseShellIntegrationPayload(payload: Uint8Array): TerminalShellIntegrationEvent | null {
  const text = decodeAscii(payload);
  const protocol = text.startsWith(OSC_633_PREFIX)
    ? '633'
    : text.startsWith(OSC_133_PREFIX)
      ? '133'
      : null;
  const body = protocol === '633'
    ? text.slice(OSC_633_PREFIX.length)
    : protocol === '133'
      ? text.slice(OSC_133_PREFIX.length)
      : null;

  if (body == null) {
    return null;
  }
  if (body === 'A') {
    return { kind: 'prompt-ready' };
  }
  if (body === 'B') {
    return { kind: 'command-start' };
  }
  if (body === 'D') {
    return { kind: 'command-finish', exitCode: null };
  }
  if (body.startsWith('D;')) {
    const rawExitCode = body.slice(2).trim();
    const exitCode = Number(rawExitCode);
    return {
      kind: 'command-finish',
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
    };
  }
  if (protocol === '633' && body === 'P;RedevenActivity=busy') {
    return { kind: 'program-activity', phase: 'busy' };
  }
  if (protocol === '633' && body === 'P;RedevenActivity=idle') {
    return { kind: 'program-activity', phase: 'idle' };
  }
  return null;
}

function decodeAscii(payload: Uint8Array): string {
  let text = '';
  for (const value of payload) {
    text += String.fromCharCode(value);
  }
  return text;
}

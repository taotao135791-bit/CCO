export interface TerminalMouseEvent {
  button: number;
  x: number;
  y: number;
  release: boolean;
}

type MouseListener = (event: TerminalMouseEvent) => void;
type StdinEmit = (eventName: string | symbol, ...args: any[]) => boolean;

const SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const MOUSE_PREFIX = '\x1b[<';
const listeners = new Set<MouseListener>();

let installed = false;
let originalEmit: StdinEmit | null = null;
let parser: TerminalMouseInputParser | null = null;
let flushTimer: NodeJS.Timeout | null = null;

export class TerminalMouseInputParser {
  private pending = '';

  push(chunk: string): { text: string; events: TerminalMouseEvent[]; pending: boolean } {
    this.pending += chunk;
    const result = this.drain(false);
    return { ...result, pending: this.pending.length > 0 };
  }

  flush(): { text: string; events: TerminalMouseEvent[] } {
    return this.drain(true);
  }

  private drain(flush: boolean): { text: string; events: TerminalMouseEvent[] } {
    let input = this.pending;
    let text = '';
    const events: TerminalMouseEvent[] = [];
    this.pending = '';

    while (input.length > 0) {
      const escIndex = input.indexOf('\x1b');
      if (escIndex === -1) {
        text += input;
        break;
      }

      if (escIndex > 0) {
        text += input.slice(0, escIndex);
        input = input.slice(escIndex);
        continue;
      }

      const mouse = SGR_MOUSE_PATTERN.exec(input);
      if (mouse) {
        events.push({
          button: Number(mouse[1]),
          x: Number(mouse[2]),
          y: Number(mouse[3]),
          release: mouse[4] === 'm',
        });
        input = input.slice(mouse[0].length);
        continue;
      }

      if (isPartialSgrMouse(input)) {
        if (flush) {
          // A timed-out SGR mouse prefix is almost certainly a torn mouse packet.
          // Dropping it is better than letting terminal control bytes enter the prompt.
          if (input.startsWith(MOUSE_PREFIX)) {
            break;
          }
          text += input;
          break;
        }

        this.pending = input;
        break;
      }

      text += input[0];
      input = input.slice(1);
    }

    return { text, events };
  }
}

function isPartialSgrMouse(input: string): boolean {
  if (MOUSE_PREFIX.startsWith(input)) return true;
  if (!input.startsWith(MOUSE_PREFIX)) return false;

  const body = input.slice(MOUSE_PREFIX.length);
  return /^\d*(?:;\d*(?:;\d*)?)?$/.test(body);
}

function emitMouseEvents(events: TerminalMouseEvent[]): void {
  for (const event of events) {
    for (const listener of listeners) {
      listener(event);
    }
  }
}

function scheduleFlush(stdin: NodeJS.ReadStream): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!parser || !originalEmit) return;

    const result = parser.flush();
    emitMouseEvents(result.events);
    if (result.text) {
      originalEmit.call(stdin, 'data', Buffer.from(result.text));
    }
  }, 80);
}

export function installTerminalMouseInput(): void {
  if (installed) return;

  const stdin = process.stdin;
  originalEmit = stdin.emit.bind(stdin) as StdinEmit;
  parser = new TerminalMouseInputParser();
  installed = true;

  stdin.emit = ((eventName: string | symbol, ...args: any[]) => {
    if (eventName !== 'data' || !parser || !originalEmit) {
      return originalEmit!(eventName, ...args);
    }

    const chunk = args[0];
    const raw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    const result = parser.push(raw);

    emitMouseEvents(result.events);

    if (result.pending) {
      scheduleFlush(stdin);
    } else if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (!result.text) return true;

    const forwarded = Buffer.isBuffer(chunk) ? Buffer.from(result.text) : result.text;
    return originalEmit.call(stdin, 'data', forwarded, ...args.slice(1));
  }) as NodeJS.ReadStream['emit'];
}

export function onTerminalMouseEvent(listener: MouseListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

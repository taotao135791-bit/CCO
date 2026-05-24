import { describe, expect, it } from 'vitest';
import { TerminalMouseInputParser } from '../src/core/terminal/mouse.js';

describe('terminal mouse input parser', () => {
  it('passes normal text through', () => {
    const parser = new TerminalMouseInputParser();
    expect(parser.push('hello')).toEqual({
      text: 'hello',
      events: [],
      pending: false,
    });
  });

  it('strips a complete SGR mouse event', () => {
    const parser = new TerminalMouseInputParser();
    expect(parser.push('\x1b[<64;79;17M')).toEqual({
      text: '',
      events: [{ button: 64, x: 79, y: 17, release: false }],
      pending: false,
    });
  });

  it('strips concatenated SGR mouse events', () => {
    const parser = new TerminalMouseInputParser();
    const result = parser.push('\x1b[<64;79;17M\x1b[<65;79;18M');

    expect(result.text).toBe('');
    expect(result.pending).toBe(false);
    expect(result.events).toEqual([
      { button: 64, x: 79, y: 17, release: false },
      { button: 65, x: 79, y: 18, release: false },
    ]);
  });

  it('reassembles split SGR mouse events before forwarding to Ink', () => {
    const parser = new TerminalMouseInputParser();

    // A lone '\x1b' is released immediately (it could be Escape key).
    // Reassembly only works when the split is at '\x1b[' (2+ chars) or later.
    expect(parser.push('\x1b[')).toEqual({ text: '', events: [], pending: true });
    expect(parser.push('<64;')).toEqual({ text: '', events: [], pending: true });
    expect(parser.push('79;17M')).toEqual({
      text: '',
      events: [{ button: 64, x: 79, y: 17, release: false }],
      pending: false,
    });
  });

  it('keeps surrounding keyboard input while removing mouse packets', () => {
    const parser = new TerminalMouseInputParser();
    const result = parser.push('a\x1b[<64;79;17Mb');

    expect(result).toEqual({
      text: 'ab',
      events: [{ button: 64, x: 79, y: 17, release: false }],
      pending: false,
    });
  });

  it('drops timed-out partial SGR mouse packets', () => {
    const parser = new TerminalMouseInputParser();

    expect(parser.push('\x1b[<64;79;')).toEqual({ text: '', events: [], pending: true });
    expect(parser.flush()).toEqual({ text: '', events: [] });
  });

  it('flushes a plain escape key when it is not followed by a mouse packet', () => {
    const parser = new TerminalMouseInputParser();

    // A lone '\x1b' is released immediately to prevent input corruption.
    expect(parser.push('\x1b')).toEqual({ text: '\x1b', events: [], pending: false });

    // A partial mouse prefix like '\x1b[<' IS buffered and dropped on flush.
    expect(parser.push('\x1b[<64;79;')).toEqual({ text: '', events: [], pending: true });
    expect(parser.flush()).toEqual({ text: '', events: [] });
  });
});

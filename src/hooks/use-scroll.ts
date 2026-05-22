import { useState, useEffect, useCallback } from 'react';
import { installTerminalMouseInput, onTerminalMouseEvent } from '../core/terminal/mouse.js';
import type { TranscriptLine } from './use-transcript.js';

/**
 * Hook managing scroll state, mouse wheel, scrollbar clicks, and keyboard scrolling.
 */
export function useScroll(
  transcriptLines: TranscriptLine[],
  messageViewportHeight: number,
  showAgents: boolean,
  showHelp: boolean,
  stdoutColumns: number,
) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [mouseEventNonce, setMouseEventNonce] = useState(0);

  const scrollHistory = useCallback(
    (direction: 'older' | 'newer', amount = 1) => {
      setScrollOffset((current) => {
        const maxOffset = Math.max(0, transcriptLines.length - messageViewportHeight);
        if (direction === 'older') return Math.min(current + amount, maxOffset);
        return Math.max(current - amount, 0);
      });
    },
    [transcriptLines.length, messageViewportHeight],
  );

  const jumpScrollFromMouseY = useCallback(
    (y: number) => {
      const messageAreaTop = 3 + (showHelp ? 26 : 0);
      const relativeY = y - messageAreaTop;
      const clampedY = Math.max(0, Math.min(relativeY, messageViewportHeight - 1));
      const maxOffset = Math.max(0, transcriptLines.length - messageViewportHeight);
      const denominator = Math.max(1, messageViewportHeight - 1);
      const ratioFromTop = clampedY / denominator;
      const nextOffset = Math.round((1 - ratioFromTop) * maxOffset);
      setScrollOffset(Math.max(0, Math.min(nextOffset, maxOffset)));
    },
    [showHelp, messageViewportHeight, transcriptLines.length],
  );

  // Wire terminal mouse events (SGR mode)
  useEffect(() => {
    installTerminalMouseInput();
    return onTerminalMouseEvent((mouse) => {
      setMouseEventNonce((n) => n + 1);
      if (mouse.button === 64) {
        scrollHistory('older', 3);
      } else if (mouse.button === 65) {
        scrollHistory('newer', 3);
      } else if (!mouse.release && (mouse.button === 0 || mouse.button === 32)) {
        const scrollbarColumn = stdoutColumns - (showAgents ? 26 : 1);
        if (mouse.x >= scrollbarColumn) {
          jumpScrollFromMouseY(mouse.y);
        }
      }
    });
  }, [showAgents, showHelp, stdoutColumns, transcriptLines.length, messageViewportHeight, scrollHistory, jumpScrollFromMouseY]);

  const maxScrollOffset = Math.max(0, transcriptLines.length - messageViewportHeight);
  const effectiveScrollOffset = Math.min(scrollOffset, maxScrollOffset);
  const visibleStart = Math.max(0, transcriptLines.length - messageViewportHeight - effectiveScrollOffset);
  const visibleEnd = Math.max(0, transcriptLines.length - effectiveScrollOffset);
  const visibleLines = transcriptLines.slice(visibleStart, visibleEnd);
  const topPadding = Math.max(0, messageViewportHeight - visibleLines.length);

  return {
    scrollOffset,
    setScrollOffset,
    mouseEventNonce,
    setMouseEventNonce,
    scrollHistory,
    jumpScrollFromMouseY,
    effectiveScrollOffset,
    visibleStart,
    visibleEnd,
    visibleLines,
    topPadding,
  };
}

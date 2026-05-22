import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { configManager } from '../core/config/manager.js';
import { estimateCost, formatCost } from '../core/llm/cost-estimate.js';

/* ── Braille spinner frames (smooth rotation) ── */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80; // ms per frame

/** Animated spinner that only ticks while `active` is true. */
const Spinner: React.FC<{ active: boolean; label?: string }> = ({ active, label }) => {
  const [frame, setFrame] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setFrame(0);
      return;
    }
    timerRef.current = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [active]);

  if (!active) return null;

  // Color cycles through warm palette for extra visual feedback
  const colors = ['yellow', 'green', 'cyan', 'magenta'] as const;
  const color = colors[frame % colors.length];

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color} bold>{SPINNER_FRAMES[frame]}</Text>
      {label && <Text color={color}>{label}</Text>}
    </Box>
  );
};

interface Props {
  activeAgent: string;
  agentCount: number;
  model?: string;
  isProcessing?: boolean;
  messageCount?: number;
  scrollOffset?: number;
  inputTokens?: number;
  outputTokens?: number;
  currentTool?: string;
}

export const StatusBar: React.FC<Props> = ({
  activeAgent,
  agentCount,
  model,
  isProcessing,
  messageCount,
  scrollOffset,
  inputTokens,
  outputTokens,
  currentTool,
}) => {
  const provider = configManager.get().activeProvider;
  const { stdout } = useStdout();
  const sep = '─'.repeat(Math.max(1, stdout.columns));

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="cyan" bold>CCO</Text>
          <Text color="gray">·</Text>
          <Text color="white">{provider}</Text>
          {model && (
            <>
              <Text color="gray">·</Text>
              <Text color="yellow">{model}</Text>
            </>
          )}
          {messageCount !== undefined && (
            <>
              <Text color="gray">·</Text>
              <Text color="blue">{messageCount} msgs</Text>
            </>
          )}
          {scrollOffset ? (
            <>
              <Text color="gray">·</Text>
              <Text color="magenta">↑{scrollOffset}</Text>
            </>
          ) : null}
          {(inputTokens || outputTokens) ? (
            <>
              <Text color="gray">·</Text>
              <Text color="cyan">{(inputTokens || 0) > 1000 ? `${((inputTokens || 0) / 1000).toFixed(1)}k` : inputTokens || 0}↑ {(outputTokens || 0) > 1000 ? `${((outputTokens || 0) / 1000).toFixed(1)}k` : outputTokens || 0}↓</Text>
              {model && (
                <>
                  <Text color="gray">·</Text>
                  <Text color="magenta">{formatCost(estimateCost(inputTokens || 0, outputTokens || 0, model))}</Text>
                </>
              )}
            </>
          ) : null}
        </Box>
        <Box flexDirection="row" gap={1}>
          {isProcessing ? (
            <Spinner active label={currentTool || '思考中'} />
          ) : (
            <Text color="green">✓</Text>
          )}
          <Text color="green" bold>{activeAgent}</Text>
          {agentCount > 1 && (
            <Text color="gray" dimColor>({agentCount})</Text>
          )}
        </Box>
      </Box>
      <Text color="gray" dimColor>{sep}</Text>
    </Box>
  );
};

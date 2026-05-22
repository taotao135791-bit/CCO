import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { configManager } from '../core/config/manager.js';

interface Props {
  activeAgent: string;
  agentCount: number;
  model?: string;
  isProcessing?: boolean;
  messageCount?: number;
  scrollOffset?: number;
}

export const StatusBar: React.FC<Props> = ({
  activeAgent,
  agentCount,
  model,
  isProcessing,
  messageCount,
  scrollOffset,
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
        </Box>
        <Box flexDirection="row" gap={1}>
          {isProcessing && <Text color="yellow">⏳</Text>}
          <Text color="green">{activeAgent}</Text>
          {agentCount > 1 && (
            <Text color="gray" dimColor>({agentCount})</Text>
          )}
        </Box>
      </Box>
      <Text color="gray" dimColor>{sep}</Text>
    </Box>
  );
};

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import type { AgentMessage } from '../core/agent/engine.js';
import { parseThinking } from '../hooks/use-transcript.js';

interface Props {
  message: AgentMessage;
  agentName?: string;
}

const AGENT_COLORS = ['green', 'cyan', 'magenta', 'yellow', 'blue', 'red'];
function getAgentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export const ChatMessage: React.FC<Props> = ({ message, agentName }) => {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';
  const [showThinking, setShowThinking] = useState(true);

  if (isSystem) return null;

  const agentColor = getAgentColor(agentName || 'Assistant');

  if (isTool) {
    return (
      <Box flexDirection="column" paddingLeft={4} flexShrink={0}>
        <Text color="gray" dimColor>
          ┌─ Tool Result ({message.toolCallId?.slice(0, 8)})
        </Text>
        <Text color="gray" dimColor>
          │ {message.content.slice(0, 500)}
          {message.content.length > 500 ? '...' : ''}
        </Text>
        <Text color="gray" dimColor>└─</Text>
        <Box height={1} />
      </Box>
    );
  }

  if (isUser) {
    const interAgentMatch = message.content.match(/^\[Message from ([^\]]+)\]:\s*(.*)$/s);
    if (interAgentMatch) {
      const [, fromAgent, content] = interAgentMatch;
      const fromColor = getAgentColor(fromAgent);
      return (
        <Box flexDirection="column" paddingLeft={2} borderStyle="round" borderColor="gray" flexShrink={0}>
          <Text color="gray" dimColor>💬 {fromAgent} → {agentName || 'this agent'}</Text>
          <Text color={fromColor}>{content}</Text>
          <Box height={1} />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" flexShrink={0}>
        <Text bold color="blue">{'❯'} {message.content}</Text>
        <Box height={1} />
      </Box>
    );
  }

  // Assistant message
  const { thinking, content: mainContent } = parseThinking(message.content);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* Header row: agent name + metadata */}
      <Box flexDirection="row" gap={1}>
        <Text bold color={agentColor}>{agentName || 'Assistant'}</Text>
        {thinking && <Text color="gray" dimColor>[thinking]</Text>}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Text color="yellow" dimColor>({message.toolCalls.length} tool{message.toolCalls.length > 1 ? 's' : ''})</Text>
        )}
      </Box>

      {/* Thinking block */}
      {thinking && (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color="gray" dimColor>{showThinking ? '▼' : '▶'} Thinking...</Text>
          {showThinking && (
            <Box paddingLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
              <Text color="gray" dimColor wrap="wrap">{thinking}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Main content */}
      {mainContent && (
        <Box paddingLeft={2}>
          <Text wrap="wrap">{mainContent}</Text>
        </Box>
      )}

      {/* Tool calls with diff for Edit */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {message.toolCalls.map((tc) => {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
            const isEdit = tc.function.name === 'Edit';
            const isWrite = tc.function.name === 'Write';
            return (
              <Box key={tc.id} flexDirection="column">
                <Text color="yellow" dimColor>
                  ● {tc.function.name}({tc.function.arguments.slice(0, 60)}{tc.function.arguments.length > 60 ? '...' : ''})
                </Text>
                {isEdit && args.old_string && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color="gray" dimColor>--- old</Text>
                    {args.old_string.split('\n').slice(0, 8).map((line: string, i: number) => (
                      <Text key={`o${i}`} color="red">- {line.slice(0, 120)}{line.length > 120 ? '...' : ''}</Text>
                    ))}
                    {args.old_string.split('\n').length > 8 && <Text color="gray" dimColor>  ... ({args.old_string.split('\n').length - 8} more lines)</Text>}
                    <Text color="gray" dimColor>+++ new</Text>
                    {args.new_string.split('\n').slice(0, 8).map((line: string, i: number) => (
                      <Text key={`n${i}`} color="green">+ {line.slice(0, 120)}{line.length > 120 ? '...' : ''}</Text>
                    ))}
                    {args.new_string.split('\n').length > 8 && <Text color="gray" dimColor>  ... ({args.new_string.split('\n').length - 8} more lines)</Text>}
                  </Box>
                )}
                {isWrite && args.content && (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Text color="gray" dimColor>+++ {args.file_path || 'new file'}</Text>
                    {args.content.split('\n').slice(0, 6).map((line: string, i: number) => (
                      <Text key={`w${i}`} color="green">+ {line.slice(0, 120)}{line.length > 120 ? '...' : ''}</Text>
                    ))}
                    {args.content.split('\n').length > 6 && <Text color="gray" dimColor>  ... ({args.content.split('\n').length - 6} more lines)</Text>}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Spacer between messages */}
      <Box height={1} />
    </Box>
  );
};

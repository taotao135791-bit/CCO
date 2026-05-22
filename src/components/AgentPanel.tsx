import React from 'react';
import { Box, Text } from 'ink';
import type { AgentInfo } from '../core/agent/manager.js';

interface Props {
  agents: AgentInfo[];
  activeAgentId: string;
  onSelect?: (agentId: string) => void;
}

const statusColor: Record<string, string> = {
  idle: 'gray',
  working: 'yellow',
  waiting: 'blue',
  error: 'red',
};

const statusIcon: Record<string, string> = {
  idle: '○',
  working: '●',
  waiting: '◐',
  error: '✗',
};

export const AgentPanel: React.FC<Props> = ({ agents, activeAgentId, onSelect }) => {
  if (agents.length <= 1) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minWidth={28}>
      <Text bold color="cyan">
        Agents ({agents.length})
      </Text>
      {agents.map((agent) => {
        const isActive = agent.id === activeAgentId;
        const color = statusColor[agent.status] || 'white';
        const icon = statusIcon[agent.status] || '○';

        return (
          <Box key={agent.id} flexDirection="column" marginY={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={isActive ? 'green' : 'gray'}>{isActive ? '▸' : ' '}</Text>
              <Text color={color}>{icon}</Text>
              <Text bold={isActive} color={isActive ? 'white' : 'gray'}>
                {agent.name}
              </Text>
              {agent.parentAgent && (
                <Text color="gray" dimColor>
                  ←{agent.parentAgent.slice(0, 4)}
                </Text>
              )}
            </Box>
            {agent.currentTask && (
              <Text color="gray" dimColor wrap="truncate">
                {'  '}{agent.currentTask.slice(0, 30)}
                {agent.currentTask.length > 30 ? '...' : ''}
              </Text>
            )}
            <Text color="gray" dimColor>
              {'  '}{agent.messageCount} msgs
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press Alt+1-9 to switch
        </Text>
      </Box>
    </Box>
  );
};

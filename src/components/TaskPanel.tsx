import React from 'react';
import { Box, Text } from 'ink';
import type { TaskPlan } from '../core/agent/coordinator.js';

interface Props {
  plans: Array<{ planId: string; plan: TaskPlan }>;
}

const statusColor: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  completed: 'green',
  failed: 'red',
};

const statusIcon: Record<string, string> = {
  pending: '○',
  running: '◐',
  completed: '✓',
  failed: '✗',
};

export const TaskPanel: React.FC<Props> = ({ plans }) => {
  if (plans.length === 0) return null;

  const latestPlan = plans[plans.length - 1];
  const { plan } = latestPlan;

  const completed = plan.subTasks.filter((st) => st.status === 'completed').length;
  const total = plan.subTasks.length;
  const progress = Math.round((completed / total) * 100);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="cyan">
          Parallel Tasks
        </Text>
        <Text color={progress === 100 ? 'green' : 'yellow'}>
          {completed}/{total} ({progress}%)
        </Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        {plan.subTasks.map((st) => {
          const color = statusColor[st.status] || 'white';
          const icon = statusIcon[st.status] || '○';
          return (
            <Box key={st.id} flexDirection="row" gap={1}>
              <Text color={color}>{icon}</Text>
              <Text color={color} wrap="truncate">
                {st.description.slice(0, 40)}
                {st.description.length > 40 ? '...' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Progress bar */}
      <Box flexDirection="row">
        <Text color="green">{'█'.repeat(Math.floor(progress / 10))}</Text>
        <Text color="gray">{'░'.repeat(10 - Math.floor(progress / 10))}</Text>
      </Box>
    </Box>
  );
};

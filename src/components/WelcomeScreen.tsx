import React from 'react';
import { Box, Text } from 'ink';
import { configManager } from '../core/config/manager.js';
import { authStore } from '../core/auth/auth-store.js';
import { mcpManager } from '../core/mcp/client.js';
import { detectProject } from '../core/agent/project-detect.js';
import { cwd } from 'process';
import { basename } from 'path';

const VERSION = '1.7.0';

/* ── Pixel font data (each letter: 4 cols × 5 rows) ─────────────────────── */

const LETTER_C = [
  ' ██ ',
  '██  ',
  '██  ',
  '██  ',
  ' ██ ',
];

const LETTER_O = [
  ' ██ ',
  '█  █',
  '█  █',
  '█  █',
  ' ██ ',
];

// C C O  with 2-col gap between letters  →  4+2+4+2+4 = 16 chars wide
const LOGO_ROWS: string[][] = [];
for (let r = 0; r < 5; r++) {
  LOGO_ROWS.push([
    LETTER_C[r], '  ',
    LETTER_C[r], '  ',
    LETTER_O[r],
  ]);
}

const LOGO_COLORS = ['cyan', 'cyan', 'blue', 'magenta', 'magenta'] as const;

/* ── Sub-components ──────────────────────────────────────────────────────── */

const PixelLogo: React.FC = () => (
  <Box flexDirection="column" flexShrink={0}>
    {LOGO_ROWS.map((segments, r) => (
      <Box key={r}>
        <Text color={LOGO_COLORS[r]} bold>{segments.join('')}</Text>
      </Box>
    ))}
  </Box>
);

const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) => (
  <Text color={ok ? 'green' : 'yellow'}>{ok ? '✓' : '○'}</Text>
);

const FeatureTag: React.FC<{ label: string; ok?: boolean }> = ({ label, ok = true }) => (
  <Box gap={1}>
    <StatusDot ok={ok} />
    <Text color={ok ? 'white' : 'gray'} dimColor={!ok}>{label}</Text>
  </Box>
);

/* ── Main component ──────────────────────────────────────────────────────── */

export const WelcomeScreen: React.FC = () => {
  const provider = configManager.getActiveProvider();
  const projectName = configManager.get().activeProvider;
  const project = detectProject(cwd());
  const dirName = basename(cwd());
  const hasKey = !!(provider.apiKey || authStore.hasKey(provider.name));
  const mcpCount = mcpManager.getAllTools().length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2}>
      {/* ── Brand header: Logo + Info ── */}
      <Box flexDirection="row" gap={4}>
        <PixelLogo />
        <Box flexDirection="column" justifyContent="center" gap={1}>
          <Box gap={2}>
            <Text color="white" bold>CCO</Text>
            <Text color="gray" dimColor>v{VERSION}</Text>
            <Text color="gray" dimColor>·</Text>
            <Text color="gray" dimColor>MIT</Text>
          </Box>
          <Box gap={1}>
            <Text color="gray">Provider:</Text>
            <Text color="cyan">{projectName}</Text>
            <Text color="gray">·</Text>
            <Text color="yellow">{provider.defaultModel}</Text>
          </Box>
          <Box gap={1}>
            <StatusDot ok={hasKey} />
            <Text color={hasKey ? 'green' : 'red'}>
              API Key {hasKey ? '已配置' : '未配置'}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box height={1} />

      {/* ── Working directory banner ── */}
      <Box borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">⚡</Text>
        <Text color="white"> 工作目录: </Text>
        <Text color="cyan" bold>{dirName}</Text>
        <Text color="gray"> ({project.language} / {project.type})</Text>
      </Box>

      <Box height={1} />

      {/* ── Feature status tags ── */}
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        <FeatureTag label="多 Agent 系统" />
        <FeatureTag label="14 个内置工具" />
        <FeatureTag label="权限系统" />
        <FeatureTag label={`MCP${mcpCount > 0 ? ` (${mcpCount})` : ''}`} ok={mcpCount > 0} />
        <FeatureTag label="上下文管理" />
        <FeatureTag label="会话持久化" />
      </Box>

      <Box height={1} />

      {/* ── Separator ── */}
      <Text color="gray" dimColor>{'─'.repeat(56)}</Text>

      <Box height={1} />

      {/* ── Quick commands ── */}
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">快速命令</Text>
        <Box flexDirection="row" gap={4}>
          <Box flexDirection="column" gap={1}>
            <Box gap={2}>
              <Text color="cyan">/help</Text>
              <Text color="gray">查看所有命令</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/new</Text>
              <Text color="gray">创建 Agent</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/review</Text>
              <Text color="gray">代码审查</Text>
            </Box>
          </Box>
          <Box flexDirection="column" gap={1}>
            <Box gap={2}>
              <Text color="cyan">/model</Text>
              <Text color="gray">切换模型</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/config</Text>
              <Text color="gray">配置信息</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/mcp</Text>
              <Text color="gray">MCP 管理</Text>
            </Box>
          </Box>
          <Box flexDirection="column" gap={1}>
            <Box gap={2}>
              <Text color="cyan">/delegate</Text>
              <Text color="gray">并行任务</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/sessions</Text>
              <Text color="gray">加载会话</Text>
            </Box>
            <Box gap={2}>
              <Text color="cyan">/cost</Text>
              <Text color="gray">费用统计</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box height={1} />

      {/* ── Keyboard shortcuts ── */}
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">快捷键</Text>
        <Box flexDirection="row" gap={4}>
          <Box gap={1}>
            <Text color="magenta">Tab</Text>
            <Text color="gray">Agent 面板</Text>
          </Box>
          <Box gap={1}>
            <Text color="magenta">Esc</Text>
            <Text color="gray">中断/退出</Text>
          </Box>
          <Box gap={1}>
            <Text color="magenta">PgUp/Dn</Text>
            <Text color="gray">滚动历史</Text>
          </Box>
          <Box gap={1}>
            <Text color="magenta">Alt+1-9</Text>
            <Text color="gray">快速切换</Text>
          </Box>
        </Box>
      </Box>

      {/* ── Spacer ── */}
      <Box flexGrow={1} />

      {/* ── Bottom hint ── */}
      <Box flexDirection="row" gap={2}>
        <Text color="gray" dimColor>输入消息开始对话，或输入</Text>
        <Text color="cyan">/</Text>
        <Text color="gray" dimColor>查看命令列表</Text>
      </Box>
    </Box>
  );
};

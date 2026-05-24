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
    <Box flexDirection="column" flexShrink={0} paddingX={2}>
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

      {/* ── Working directory banner (no border, simpler layout) ── */}
      <Box gap={1}>
        <Text color="yellow">⚡ 工作目录:</Text>
        <Text color="cyan" bold>{dirName}</Text>
        <Text color="gray">({project.language} / {project.type})</Text>
      </Box>

      <Box height={1} />

      {/* ── Feature status tags (two rows) ── */}
      <Box flexDirection="row" gap={3}>
        <FeatureTag label="多Agent" />
        <FeatureTag label="14工具" />
        <FeatureTag label="权限" />
        <FeatureTag label={`MCP${mcpCount > 0 ? `(${mcpCount})` : ''}`} ok={mcpCount > 0} />
        <FeatureTag label="上下文" />
        <FeatureTag label="持久化" />
      </Box>

      <Box height={1} />

      {/* ── Separator ── */}
      <Box flexGrow={0} flexShrink={1}>
        <Text color="gray" dimColor>{'─'.repeat(60)}</Text>
      </Box>

      <Box height={1} />

      {/* ── Quick commands ── */}
      <Box flexDirection="column">
        <Text bold color="cyan">快速命令</Text>
        <Box flexDirection="row" gap={4}>
          <Box flexDirection="column">
            <Text><Text color="cyan">/help     </Text><Text color="gray">所有命令</Text></Text>
            <Text><Text color="cyan">/new      </Text><Text color="gray">创建 Agent</Text></Text>
            <Text><Text color="cyan">/review   </Text><Text color="gray">代码审查</Text></Text>
            <Text><Text color="cyan">/delegate </Text><Text color="gray">并行任务</Text></Text>
          </Box>
          <Box flexDirection="column">
            <Text><Text color="cyan">/model    </Text><Text color="gray">切换模型</Text></Text>
            <Text><Text color="cyan">/config   </Text><Text color="gray">配置信息</Text></Text>
            <Text><Text color="cyan">/mcp      </Text><Text color="gray">MCP 管理</Text></Text>
            <Text><Text color="cyan">/sessions </Text><Text color="gray">加载会话</Text></Text>
          </Box>
        </Box>
      </Box>

      <Box height={1} />

      {/* ── Keyboard shortcuts ── */}
      <Box flexDirection="column">
        <Text bold color="cyan">快捷键</Text>
        <Text>
          <Text color="magenta">Tab </Text><Text color="gray">面板 </Text>
          <Text color="magenta"> Esc </Text><Text color="gray">中断 </Text>
          <Text color="magenta"> PgUp/Dn </Text><Text color="gray">滚动 </Text>
          <Text color="magenta"> Alt+1-9 </Text><Text color="gray">切换</Text>
        </Text>
      </Box>

      {/* ── Bottom hint ── */}
      <Text color="gray" dimColor>输入消息开始对话，或输入 <Text color="cyan">/</Text> 查看命令列表</Text>
    </Box>
  );
};

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderConfig } from '../core/config/manager.js';
import { authStore } from '../core/auth/auth-store.js';

/** Provider groups for organized display (inspired by opencode) */
const PROVIDER_GROUPS: Record<string, string[]> = {
  '推荐': ['openrouter', 'deepseek', 'anthropic', 'openai'],
  '国内服务商': ['kimi', 'volcengine', 'zhipu', 'dashscope', 'minimax', 'xiaomi-mimo', 'siliconflow'],
  '国际服务商': ['gemini'],
  '自定义': ['custom-openai', 'custom-anthropic'],
};

const GROUP_ORDER = ['推荐', '国内服务商', '国际服务商', '自定义'];

interface FlatItem {
  provider: ProviderConfig;
  group: string;
  isHeader?: boolean;
  headerLabel?: string;
}

interface Props {
  providers: ProviderConfig[];
  activeProvider: string;
  onSelect: (providerName: string) => void;
  onCancel: () => void;
}

export const ProviderSelect: React.FC<Props> = ({ providers, activeProvider, onSelect, onCancel }) => {
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    const searchLower = search.toLowerCase();

    // Build provider lookup
    const providerMap = new Map(providers.map((p) => [p.name, p]));

    for (const group of GROUP_ORDER) {
      const names = PROVIDER_GROUPS[group] || [];
      const groupProviders = names
        .map((n) => providerMap.get(n))
        .filter((p): p is ProviderConfig => !!p)
        .filter((p) => {
          if (!searchLower) return true;
          return p.name.toLowerCase().includes(searchLower) ||
            p.defaultModel.toLowerCase().includes(searchLower);
        });

      if (groupProviders.length === 0) continue;

      items.push({ provider: groupProviders[0], group, isHeader: true, headerLabel: group });
      for (const p of groupProviders) {
        items.push({ provider: p, group });
      }
    }

    // Add any providers not in predefined groups
    const allGrouped = new Set(Object.values(PROVIDER_GROUPS).flat());
    const ungrouped = providers.filter(
      (p) => !allGrouped.has(p.name) &&
        (!searchLower || p.name.toLowerCase().includes(searchLower))
    );
    if (ungrouped.length > 0) {
      items.push({ provider: ungrouped[0], group: '其他', isHeader: true, headerLabel: '其他' });
      for (const p of ungrouped) {
        items.push({ provider: p, group: '其他' });
      }
    }

    return items;
  }, [providers, search]);

  const selectableItems = flatItems.filter((item) => !item.isHeader);

  // Auto-select active provider on mount
  useMemo(() => {
    const idx = selectableItems.findIndex((item) => item.provider.name === activeProvider);
    if (idx >= 0) setIndex(idx);
  }, []);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      const item = selectableItems[index];
      if (item) onSelect(item.provider.name);
      return;
    }
    if (key.upArrow) {
      setIndex((i) => (i > 0 ? i - 1 : selectableItems.length - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => (i < selectableItems.length - 1 ? i + 1 : 0));
      return;
    }
    // Backspace
    if (key.backspace) {
      setSearch((s) => s.slice(0, -1));
      setIndex(0);
      return;
    }
    // Printable character for search
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setSearch((s) => s + input);
      setIndex(0);
    }
  });

  // Visible window
  const maxVisible = 16;
  const scrollStart = Math.max(0, Math.min(
    index - Math.floor(maxVisible / 2),
    selectableItems.length - maxVisible
  ));

  let selectableIdx = -1;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="cyan">🔗 选择 API 提供商</Text>
        {search && <Text color="gray"> 🔍 {search}</Text>}
      </Box>
      <Text color="gray" dimColor>↑↓ 导航 · Enter 选择 · Esc 取消 · 输入搜索</Text>
      <Box flexDirection="column" marginTop={1}>
        {flatItems.map((item, i) => {
          if (item.isHeader) {
            return (
              <Box key={`h-${item.group}-${i}`} flexDirection="row" marginTop={i > 0 ? 1 : 0}>
                <Text bold color="magenta" dimColor>  ── {item.headerLabel} ──</Text>
              </Box>
            );
          }
          selectableIdx++;
          const currentIdx = selectableIdx;
          const isSelected = currentIdx === index;
          const p = item.provider;
          const hasKey = authStore.hasKey(p.name) || !!p.apiKey;
          const isActive = p.name === activeProvider;

          // Scroll window
          if (currentIdx < scrollStart || currentIdx >= scrollStart + maxVisible) {
            return <Box key={p.name} height={0} />;
          }

          return (
            <Box key={p.name} flexDirection="row" gap={1}>
              <Text color={isSelected ? 'green' : 'gray'}>{isSelected ? ' ▸' : '  '}</Text>
              <Text bold={isSelected} color={isSelected ? 'cyan' : hasKey ? 'white' : 'gray'}>
                {p.name.padEnd(18)}
              </Text>
              <Text color="gray" dimColor>{p.format === 'anthropic' ? 'ANT' : 'OAI'}</Text>
              {hasKey && <Text color="green"> ✓</Text>}
              {isActive && <Text color="yellow"> ★ 当前</Text>}
            </Box>
          );
        })}
      </Box>
      {selectableItems.length > maxVisible && (
        <Text color="gray" dimColor>
          {scrollStart > 0 ? '↑ ' : '  '}
          {scrollStart + maxVisible < selectableItems.length ? '↓ 更多' : '      '}
          {' '}({index + 1}/{selectableItems.length})
        </Text>
      )}
    </Box>
  );
};

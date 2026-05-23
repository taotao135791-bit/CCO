import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderConfig } from '../core/config/manager.js';

interface Props {
  provider: ProviderConfig;
  currentModel: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

/** Simple fuzzy match: each char in query must appear in order in target */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export const ModelSelect: React.FC<Props> = ({ provider, currentModel, onSelect, onCancel }) => {
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);

  const models = provider.models || [provider.defaultModel];

  const filtered = useMemo(() => {
    if (!search) return models;
    return models.filter((m) => fuzzyMatch(search, m));
  }, [models, search]);

  // Auto-select current model
  useMemo(() => {
    const idx = filtered.indexOf(currentModel);
    if (idx >= 0) setIndex(idx);
  }, []);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      const model = filtered[index];
      if (model) onSelect(model);
      return;
    }
    if (key.upArrow) {
      setIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      return;
    }
    if (key.backspace) {
      setSearch((s) => s.slice(0, -1));
      setIndex(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      setSearch((s) => s + input);
      setIndex(0);
    }
  });

  const maxVisible = 14;
  const scrollStart = Math.max(0, Math.min(
    index - Math.floor(maxVisible / 2),
    filtered.length - maxVisible
  ));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="green">🧠 选择模型</Text>
        <Text color="gray">({provider.name})</Text>
        {search && <Text color="gray"> 🔍 {search}</Text>}
      </Box>
      <Text color="gray" dimColor>↑↓ 导航 · Enter 选择 · Esc 取消 · 输入搜索</Text>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 && (
          <Text color="gray" dimColor>  无匹配模型</Text>
        )}
        {filtered.map((model, i) => {
          if (i < scrollStart || i >= scrollStart + maxVisible) {
            return <Box key={model} height={0} />;
          }
          const isSelected = i === index;
          const isCurrent = model === currentModel;

          return (
            <Box key={model} flexDirection="row" gap={1}>
              <Text color={isSelected ? 'green' : 'gray'}>{isSelected ? ' ▸' : '  '}</Text>
              <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
                {model}
              </Text>
              {isCurrent && <Text color="yellow"> ★ 当前</Text>}
            </Box>
          );
        })}
      </Box>
      {filtered.length > maxVisible && (
        <Text color="gray" dimColor>
          {scrollStart > 0 ? '↑ ' : '  '}
          {scrollStart + maxVisible < filtered.length ? '↓ 更多' : '      '}
          {' '}({index + 1}/{filtered.length})
        </Text>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          BaseURL: {provider.baseURL}
        </Text>
      </Box>
    </Box>
  );
};

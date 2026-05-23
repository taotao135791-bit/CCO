import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface CommandItem {
  cmd: string;
  desc: string;
}

const HISTORY_DIR = join(homedir(), '.cco');
const HISTORY_FILE = join(HISTORY_DIR, 'history');
const MAX_HISTORY = 200;

function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, 'utf-8');
      return data.split('\n').filter(Boolean).slice(-MAX_HISTORY);
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory(history: string[]): void {
  try {
    mkdirSync(HISTORY_DIR, { recursive: true });
    const lines = history.slice(-MAX_HISTORY).join('\n');
    writeFileSync(HISTORY_FILE, lines, 'utf-8');
  } catch { /* ignore */ }
}

const COMMANDS: CommandItem[] = [
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/quit', desc: '退出程序' },
  { cmd: '/clear', desc: '清空聊天' },
  { cmd: '/new', desc: '创建新 Agent' },
  { cmd: '/role', desc: '创建带角色 Agent' },
  { cmd: '/kill', desc: '移除 Agent' },
  { cmd: '/agent', desc: '切换 Agent' },
  { cmd: '/agents', desc: '切换面板' },
  { cmd: '/msg', desc: '发送消息' },
  { cmd: '/broadcast', desc: '广播消息' },
  { cmd: '/delegate', desc: '并行任务' },
  { cmd: '/review', desc: '代码审查' },
  { cmd: '/pair', desc: '结对编程' },
  { cmd: '/swarm', desc: '多文件处理' },
  { cmd: '/tasks', desc: '任务面板' },
  { cmd: '/save', desc: '保存会话' },
  { cmd: '/load', desc: '加载会话' },
  { cmd: '/sessions', desc: '列出会话' },
  { cmd: '/branch', desc: '会话分支' },
  { cmd: '/cost', desc: '查看费用' },
  { cmd: '/rules', desc: '查看规则' },
  { cmd: '/skill', desc: '技能系统' },
  { cmd: '/index', desc: '构建索引' },
  { cmd: '/search', desc: '搜索代码' },
  { cmd: '/mcp', desc: 'MCP 服务器' },
  { cmd: '/project', desc: '项目类型检测' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/provider', desc: '切换提供商' },
  { cmd: '/config', desc: '显示配置' },
  { cmd: '/diff', desc: '文件变更汇总' },
  { cmd: '/perf', desc: '性能分析' },
  { cmd: '/template', desc: '项目模板' },
  { cmd: '/plugins', desc: '插件系统' },
];

const NO_ARG_COMMANDS = new Set([
  '/help', '/quit', '/clear', '/agents', '/tasks', '/save', '/sessions', '/config', '/cost', '/rules', '/project', '/diff', '/perf', '/plugins',
]);

const MENU_HEIGHT = 12;
const CMD_WIDTH = 14;
const MOUSE_SEQUENCE = /(?:\x1b\[)?\[?<?\d+;\d+;\d+[Mm]/g;
const MOUSE_SEQUENCE_ONLY = /^(?:(?:\x1b\[)?\[?<?\d+;\d+;\d+[Mm])+$/;
const MOUSE_FRAGMENT_CHARS = /^[\x1b[<0-9;Mm]+$/;

function stripMouseSequences(value: string): string {
  return value.replace(MOUSE_SEQUENCE, '');
}

function isMousePayload(input: string, guardActive: boolean): boolean {
  if (!input) return false;
  if (MOUSE_SEQUENCE_ONLY.test(input)) return true;
  if (/[0-9]+;[0-9]+;[0-9]+[Mm]/.test(input) && MOUSE_FRAGMENT_CHARS.test(input)) return true;
  return guardActive && MOUSE_FRAGMENT_CHARS.test(input);
}

function isPrintableInput(input: string): boolean {
  if (!input) return false;
  if (input === '\t' || input === '\r' || input === '\n') return false;
  return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input);
}

interface Props {
  onSubmit: (value: string) => void;
  onCommand?: (cmd: string, args: string[]) => void;
  disabled?: boolean;
  disabledText?: string;
  mouseEventNonce?: number;
  placeholder?: string;
  onMenuToggle?: (isOpen: boolean, lineCount: number) => void;
}

export const InputBox: React.FC<Props> = ({
  onSubmit,
  onCommand,
  disabled,
  disabledText = 'Thinking...',
  mouseEventNonce,
  onMenuToggle,
  placeholder = '输入任何问题，或输入 / 查看命令',
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuClosed, setMenuClosed] = useState(true);
  const [mouseGuardActive, setMouseGuardActive] = useState(false);

  const queryRef = useRef(query);
  const cursorRef = useRef(cursor);
  const menuIndexRef = useRef(menuIndex);
  const menuClosedRef = useRef(menuClosed);
  const showMenuRef = useRef(false);
  const mouseGuardUntilRef = useRef(0);
  const hasSeenMouseNonceRef = useRef(false);
  const mouseGuardTimerRef = useRef<NodeJS.Timeout | null>(null);

  const updateQuery = (value: string, nextCursor = value.length) => {
    const safeCursor = Math.max(0, Math.min(nextCursor, value.length));
    setQuery(value);
    setCursor(safeCursor);
    queryRef.current = value;
    cursorRef.current = safeCursor;
  };

  const closeMenu = () => {
    setMenuClosed(true);
    menuClosedRef.current = true;
    showMenuRef.current = false;
  };

  useEffect(() => { queryRef.current = query; }, [query]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { menuIndexRef.current = menuIndex; }, [menuIndex]);
  useEffect(() => { menuClosedRef.current = menuClosed; }, [menuClosed]);

  useEffect(() => {
    if (mouseEventNonce === undefined) return;
    if (!hasSeenMouseNonceRef.current) {
      hasSeenMouseNonceRef.current = true;
      return;
    }

    mouseGuardUntilRef.current = Date.now() + 320;
    setMouseGuardActive(true);
    updateQuery(stripMouseSequences(queryRef.current), Math.min(cursorRef.current, queryRef.current.length));
    if (mouseGuardTimerRef.current) {
      clearTimeout(mouseGuardTimerRef.current);
    }
    mouseGuardTimerRef.current = setTimeout(() => {
      setMouseGuardActive(false);
      mouseGuardTimerRef.current = null;
    }, 320);
  }, [mouseEventNonce]);

  useEffect(() => {
    return () => {
      if (mouseGuardTimerRef.current) {
        clearTimeout(mouseGuardTimerRef.current);
      }
    };
  }, []);

  const filteredCommands = useMemo(() => {
    if (!query.startsWith('/')) return [];
    const search = query.slice(1).toLowerCase();
    if (!search) return COMMANDS;
    return COMMANDS.filter((c) => c.cmd.slice(1).startsWith(search));
  }, [query]);

  const showMenu = filteredCommands.length > 0 && !disabled && !menuClosed && query.startsWith('/');

  useEffect(() => {
    showMenuRef.current = showMenu;
    const menuLines = showMenu ? Math.min(filteredCommands.length, MENU_HEIGHT) + (filteredCommands.length > MENU_HEIGHT ? 1 : 0) : 0;
    onMenuToggle?.(showMenu, menuLines);
  }, [showMenu, filteredCommands.length]);

  const scrollOffset = useMemo(() => {
    if (!showMenu) return 0;
    if (filteredCommands.length <= MENU_HEIGHT) return 0;
    return Math.max(0, Math.min(menuIndex, filteredCommands.length - MENU_HEIGHT));
  }, [showMenu, menuIndex, filteredCommands.length]);

  const visibleCommands = showMenu
    ? filteredCommands.slice(scrollOffset, scrollOffset + MENU_HEIGHT)
    : [];

  const submitQuery = (value: string) => {
    if (showMenuRef.current) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ');
      onCommand?.(parts[0], parts.slice(1));
    } else {
      onSubmit(trimmed);
    }

    setHistory((h) => {
      const next = [...h, trimmed];
      saveHistory(next);
      return next;
    });
    setHistoryIndex(-1);
    updateQuery('', 0);
    closeMenu();
  };

  useInput((input, key) => {
    if (disabled) return;

    const guardActive = Date.now() < mouseGuardUntilRef.current;
    if (isMousePayload(input, guardActive)) {
      mouseGuardUntilRef.current = Date.now() + 320;
      setMouseGuardActive(true);
      return;
    }

    const currentMenu = filteredCommands;
    const currentIndex = menuIndexRef.current;
    const currentQuery = queryRef.current;
    const currentCursor = cursorRef.current;

    if (showMenuRef.current) {
      if (key.upArrow) {
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : currentMenu.length - 1;
        setMenuIndex(nextIndex);
        menuIndexRef.current = nextIndex;
        return;
      }
      if (key.downArrow) {
        const nextIndex = currentIndex < currentMenu.length - 1 ? currentIndex + 1 : 0;
        setMenuIndex(nextIndex);
        menuIndexRef.current = nextIndex;
        return;
      }
      if (key.return || key.tab) {
        const selected = currentMenu[currentIndex];
        if (selected) {
          if (NO_ARG_COMMANDS.has(selected.cmd)) {
            onCommand?.(selected.cmd.slice(1), []);
            updateQuery('', 0);
            closeMenu();
          } else {
            updateQuery(selected.cmd + ' ');
            setMenuIndex(0);
            menuIndexRef.current = 0;
            closeMenu();
          }
        }
        return;
      }
      if (key.escape) {
        closeMenu();
        return;
      }
    }

    if (key.return) {
      submitQuery(currentQuery);
      return;
    }

    if (!showMenuRef.current && key.upArrow && history.length > 0) {
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      updateQuery(history[nextIndex]);
      return;
    }

    if (!showMenuRef.current && key.downArrow) {
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        updateQuery('', 0);
      } else {
        setHistoryIndex(nextIndex);
        updateQuery(history[nextIndex]);
      }
      return;
    }

    if (key.leftArrow) {
      const nextCursor = Math.max(0, currentCursor - 1);
      setCursor(nextCursor);
      cursorRef.current = nextCursor;
      return;
    }

    if (key.rightArrow) {
      const nextCursor = Math.min(currentQuery.length, currentCursor + 1);
      setCursor(nextCursor);
      cursorRef.current = nextCursor;
      return;
    }

    if (key.backspace) {
      if (currentCursor > 0) {
        const newQuery =
          currentQuery.slice(0, currentCursor - 1) + currentQuery.slice(currentCursor);
        updateQuery(newQuery, currentCursor - 1);
        // Update menu state after backspace
        if (!newQuery.startsWith('/') && !menuClosedRef.current) {
          closeMenu();
        }
      }
      return;
    }

    if (key.delete) {
      if (currentCursor < currentQuery.length) {
        const newQuery =
          currentQuery.slice(0, currentCursor) + currentQuery.slice(currentCursor + 1);
        updateQuery(newQuery, currentCursor);
        // Update menu state after delete
        if (!newQuery.startsWith('/') && !menuClosedRef.current) {
          closeMenu();
        }
      }
      return;
    }

    if (key.ctrl && input === 'a') {
      setCursor(0);
      cursorRef.current = 0;
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursor(currentQuery.length);
      cursorRef.current = currentQuery.length;
      return;
    }

    if (!isPrintableInput(input) || key.ctrl || key.meta) return;

    const cleanedInput = stripMouseSequences(input);
    if (!cleanedInput || isMousePayload(cleanedInput, guardActive)) return;

    const nextQuery =
      currentQuery.slice(0, currentCursor) +
      cleanedInput +
      currentQuery.slice(currentCursor);
    updateQuery(nextQuery, currentCursor + cleanedInput.length);
    setHistoryIndex(-1);

    if (nextQuery.startsWith('/')) {
      // Always open/keep menu when query starts with /
      if (menuClosedRef.current) {
        setMenuClosed(false);
        menuClosedRef.current = false;
      }
      setMenuIndex(0);
      menuIndexRef.current = 0;
    } else {
      if (!menuClosedRef.current) {
        closeMenu();
      }
    }
  });

  const renderInputValue = () => {
    if (!query) {
      return (
        <>
          <Text color="gray" dimColor>{placeholder}</Text>
          <Text inverse> </Text>
        </>
      );
    }

    const before = query.slice(0, cursor);
    const cursorChar = query[cursor] || ' ';
    const after = query.slice(cursor + (query[cursor] ? 1 : 0));

    return (
      <>
        <Text>{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{after}</Text>
      </>
    );
  };

  return (
    <Box flexDirection="column" width="100%">
      {showMenu && (
        <Box flexDirection="column" paddingX={1}>
          {visibleCommands.map((item, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === menuIndex;
            return (
              <Box key={item.cmd} flexDirection="row" gap={1}>
                <Text color={isSelected ? 'green' : 'gray'}>
                  {isSelected ? '▸' : ' '}
                </Text>
                <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
                  {item.cmd.padEnd(CMD_WIDTH)}
                </Text>
                <Text color="gray" dimColor>{item.desc}</Text>
              </Box>
            );
          })}
          {filteredCommands.length > MENU_HEIGHT && (
            <Text color="gray" dimColor>
              {scrollOffset > 0 ? '↑ ' : '  '}
              {scrollOffset + visibleCommands.length < filteredCommands.length ? '↓ more' : '     '}
            </Text>
          )}
        </Box>
      )}

      <Box flexDirection="row" paddingX={1}>
        <Text color={disabled ? 'gray' : 'cyan'} bold>{disabled ? '>' : '❯'} </Text>
        {disabled ? (
          <Text color="gray">{disabledText}</Text>
        ) : mouseGuardActive ? (
          <Text color={query ? 'white' : 'gray'} dimColor={!query}>
            {query || placeholder}
          </Text>
        ) : (
          <Box flexDirection="row">{renderInputValue()}</Box>
        )}
      </Box>
    </Box>
  );
};

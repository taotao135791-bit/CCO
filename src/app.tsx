import React, { useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { agentManager } from './core/agent/manager.js';
import { configManager } from './core/config/manager.js';
import { onTerminalMouseEvent } from './core/terminal/mouse.js';
import { useAgentManager } from './hooks/use-agent-manager.js';
import { useTranscript } from './hooks/use-transcript.js';
import { useScroll } from './hooks/use-scroll.js';
import { useCommands } from './hooks/use-commands.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { AgentPanel } from './components/AgentPanel.js';
import { TaskPanel } from './components/TaskPanel.js';

/* ── Mouse input parsing ─────────────────────────────────────────────────── */

const MOUSE_EVENT_PATTERN = /(?:\x1b\[)?\[?<?(\d+);(\d+);(\d+)([Mm])/g;
const MOUSE_SEQUENCE_ONLY = /^(?:(?:\x1b\[)?\[?<?\d+;\d+;\d+[Mm])+$/;
const MOUSE_FRAGMENT_CHARS = /^[\x1b[<0-9;Mm]+$/;

function parseMouseEvents(input: string) {
  return Array.from(input.matchAll(MOUSE_EVENT_PATTERN), (match) => ({
    button: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    release: match[4] === 'm',
  }));
}

function isMouseInput(input: string): boolean {
  if (!input) return false;
  if (MOUSE_SEQUENCE_ONLY.test(input)) return true;
  return /[0-9]+;[0-9]+;[0-9]+[Mm]/.test(input) && MOUSE_FRAGMENT_CHARS.test(input);
}

/* ── Scrollbar component ─────────────────────────────────────────────────── */

interface ScrollBarProps { total: number; offset: number; height: number; viewport: number }

const HistoryScrollBar: React.FC<ScrollBarProps> = ({ total, offset, height, viewport }) => {
  const rows = Math.max(3, height);
  const maxOffset = Math.max(0, total - viewport);
  if (maxOffset === 0) {
    return (
      <Box flexDirection="column" width={1} height={rows}>
        {Array.from({ length: rows }).map((_, i) => (
          <Text key={i} color="gray" dimColor>│</Text>
        ))}
      </Box>
    );
  }
  const thumbSize = Math.max(1, Math.floor((viewport / Math.max(total, viewport)) * rows));
  const travel = Math.max(0, rows - thumbSize);
  const normalized = Math.max(0, Math.min(offset / maxOffset, 1));
  const thumbStart = travel - Math.round(normalized * travel);
  return (
    <Box flexDirection="column" width={1} height={rows}>
      {Array.from({ length: rows }).map((_, i) => {
        const inThumb = i >= thumbStart && i < thumbStart + thumbSize;
        return (
          <Text key={i} color={inThumb ? 'cyan' : 'gray'} dimColor={!inThumb}>
            {inThumb ? '█' : '│'}
          </Text>
        );
      })}
    </Box>
  );
};

/* ── Main App ─────────────────────────────────────────────────────────────── */

export const App: React.FC = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  /* Agent state */
  const {
    messages, setMessages, isProcessing, setIsProcessing,
    activeAgentId, setActiveAgentId, agents, plans,
    showTaskPanel, setShowTaskPanel,
    pendingPermission, decidePermission,
    handleSubmit, addSystemMessage, tokenCounts, contextPercent, currentTool,
  } = useAgentManager();

  /* UI toggles */
  const [showHelp, setShowHelp] = React.useState(false);
  const [showAgents, setShowAgents] = React.useState(false);
  const [menuLines, setMenuLines] = React.useState(0);

  /* ID helper – stable ref */
  const idCounterRef = React.useRef(0);
  const nextId = (prefix?: string) => {
    idCounterRef.current += 1;
    return `${prefix || 'msg'}_${Date.now()}_${idCounterRef.current}`;
  };

  /* Transcript rendering */
  const transcriptWidth = Math.max(40, stdout.columns - (showAgents ? 30 : 4));
  const { transcriptLines } = useTranscript(messages, transcriptWidth);

  /* Layout metrics */
  const helpRows = showHelp ? 34 : 0;
  const permissionRows = pendingPermission ? 6 : 0;
  const taskRows = showTaskPanel ? 6 : 0;
  const messageViewportHeight = Math.max(3, stdout.rows - helpRows - permissionRows - taskRows - 5 - menuLines);

  /* Scroll */
  const {
    mouseEventNonce, setMouseEventNonce,
    scrollHistory, jumpScrollFromMouseY,
    effectiveScrollOffset, visibleStart, visibleLines, topPadding,
  } = useScroll(transcriptLines, messageViewportHeight, showAgents, showHelp, stdout.columns);

  /* Commands */
  const { handleCommand } = useCommands({
    setMessages, setShowHelp, setShowAgents, setShowTaskPanel,
    setIsProcessing, setActiveAgentId, activeAgentId,
    addSystemMessage, nextId, exit,
  });

  /* Enable SGR mouse mode */
  useEffect(() => {
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    return () => { process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l'); };
  }, []);

  /* ── Keyboard / mouse input ───────────────────────────────────────────── */
  useInput((input, key) => {
    // Mouse events from stdin
    const mouseEvents = parseMouseEvents(input);
    if (mouseEvents.length > 0 || isMouseInput(input)) {
      setMouseEventNonce((n) => n + 1);
      for (const mouse of mouseEvents) {
        if (mouse.button === 64) scrollHistory('older', 3);
        else if (mouse.button === 65) scrollHistory('newer', 3);
        else if (!mouse.release && (mouse.button === 0 || mouse.button === 32)) {
          const scrollbarColumn = stdout.columns - (showAgents ? 26 : 1);
          if (mouse.x >= scrollbarColumn) jumpScrollFromMouseY(mouse.y);
        }
      }
      return;
    }

    // Permission prompt keys
    if (pendingPermission) {
      const normalized = input.toLowerCase();
      if (normalized === 'y' || key.return) decidePermission('allow_once');
      else if (normalized === 'a') decidePermission('allow_session');
      else if (normalized === 'p') decidePermission('allow_always');
      else if (normalized === 'n' || key.escape) decidePermission('deny');
      return;
    }

    // Escape: abort agent first, then exit on second press
    if (key.escape) {
      if (isProcessing) {
        agentManager.getActiveAgent().abort();
        setIsProcessing(false);
        addSystemMessage('Agent 执行已中断。');
        return;
      }
      exit();
    }

    // Ctrl+C: first press interrupts, second exits
    if (key.ctrl && input === 'c') {
      if (isProcessing) {
        agentManager.getActiveAgent().abort();
        setIsProcessing(false);
        addSystemMessage('Agent 执行已中断。再按一次 Ctrl+C 退出。');
      } else {
        exit();
      }
      return;
    }

    // Scroll keys
    if (key.upArrow && key.shift) scrollHistory('older');
    if (key.downArrow && key.shift) scrollHistory('newer');
    if (key.pageUp) scrollHistory('older', Math.max(5, messageViewportHeight - 2));
    if (key.pageDown) scrollHistory('newer', Math.max(5, messageViewportHeight - 2));

    // Alt+number quick switch
    if (key.meta && input >= '1' && input <= '9') {
      const idx = parseInt(input) - 1;
      const agentList = agentManager.listAgents();
      if (agentList[idx]) {
        const agentId = agentList[idx].id;
        agentManager.setActiveAgent(agentId);
        setActiveAgentId(agentId);
      }
    }

    // Tab toggles agent panel
    if (input === '\t') setShowAgents((v) => !v);
  });

  const activeAgent = agentManager.getAgent(activeAgentId);
  const provider = configManager.getActiveProvider();

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <Box flexDirection="column" height={stdout.rows}>
      {/* Status bar */}
      <Box flexShrink={0}>
        <StatusBar
          activeAgent={activeAgent?.name || 'Main'}
          agentCount={agentManager.agents.size}
          model={provider.defaultModel}
          isProcessing={isProcessing}
          messageCount={messages.length}
          scrollOffset={effectiveScrollOffset}
          inputTokens={tokenCounts.input}
          outputTokens={tokenCounts.output}
          currentTool={currentTool || undefined}
          contextPercent={contextPercent}
        />
      </Box>

      {/* Help overlay — categorized */}
      {showHelp && (
        <Box flexDirection="column" paddingX={1}>
          <Text bold color="cyan">—— Agent 管理 ——</Text>
          <Text color="gray">/new [name]        创建新 Agent     /kill &lt;id&gt;         移除 Agent</Text>
          <Text color="gray">/role [key]        创建带角色的 Agent  /agent &lt;id&gt;        切换 Agent</Text>
          <Text color="gray">/agents, /a, Tab   切换 Agent 面板    /msg &lt;id&gt; &lt;text&gt;  向 Agent 发送消息</Text>
          <Text color="gray">/broadcast &lt;text&gt;  广播给所有 Agent   /delegate &lt;task&gt;   并行任务委派</Text>
          <Text bold color="cyan">—— 会话管理 ——</Text>
          <Text color="gray">/save              保存当前会话      /load &lt;id&gt;         加载已保存会话</Text>
          <Text color="gray">/sessions          列出已保存会话    /branch [name]     会话分支</Text>
          <Text color="gray">/clear             清空聊天记录</Text>
          <Text bold color="cyan">—— 开发工具 ——</Text>
          <Text color="gray">/review [path]     自动代码审查      /pair &lt;task&gt;       结对编程</Text>
          <Text color="gray">/swarm &lt;pat&gt; &lt;inst&gt; 多文件处理      /tasks             任务面板</Text>
          <Text color="gray">/index             构建代码索引      /search &lt;query&gt;    搜索索引代码</Text>
          <Text color="gray">/skill [name]      技能系统          /project           项目类型检测</Text>
          <Text color="gray">/diff              文件变更汇总      /perf              性能分析</Text>
          <Text color="gray">/template [name]   项目模板          /plugins           插件系统</Text>
          <Text bold color="cyan">—— 系统配置 ——</Text>
          <Text color="gray">/model &lt;name&gt;      切换模型          /provider &lt;name&gt;   切换提供商</Text>
          <Text color="gray">/cost              查看 Token 和费用  /rules             查看项目规则</Text>
          <Text color="gray">/mcp list/connect  MCP 服务器管理    /config            显示配置信息</Text>
          <Text bold color="cyan">—— 快捷键 ——</Text>
          <Text color="gray">PageUp/PageDown    滚动历史          Shift+↑↓           滚动历史</Text>
          <Text color="gray">Alt+1-9            快速切换 Agent    Esc                中断/退出</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {/* Main chat area */}
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            <Box flexDirection="column" flexGrow={1} height={messageViewportHeight} overflow="hidden">
              {topPadding > 0 && <Box height={topPadding} />}
              {visibleLines.map((line, index) => (
                <Text
                  key={`${visibleStart}_${index}`}
                  color={line.color}
                  bold={line.bold}
                  dimColor={line.dim}
                  wrap="truncate-end"
                >
                  {line.text}
                </Text>
              ))}
              {effectiveScrollOffset > 0 && (
                <Text color="gray" dimColor wrap="truncate-end">
                  ↑ 查看更早的历史记录 · 向下滚动返回
                </Text>
              )}
            </Box>
            <Box flexShrink={0} paddingRight={1}>
              <HistoryScrollBar
                total={transcriptLines.length}
                offset={effectiveScrollOffset}
                height={messageViewportHeight}
                viewport={messageViewportHeight}
              />
              <Box height={1}>
                <Text color="gray" dimColor>{effectiveScrollOffset > 0 ? '↑' : '•'}</Text>
              </Box>
            </Box>
          </Box>

          {showTaskPanel && <TaskPanel plans={plans} />}

          {pendingPermission && (
            <Box flexDirection="column" flexShrink={0} paddingX={1} paddingY={1}>
              <Text bold color="yellow">需要权限确认</Text>
              <Text>
                <Text color="cyan">{pendingPermission.request.agentName}</Text>
                {' 想要执行 '}
                <Text bold>{pendingPermission.request.toolName}</Text>
              </Text>
              {pendingPermission.request.rule && (
                <Text color="gray">匹配规则: {pendingPermission.request.rule}</Text>
              )}
              <Text color="gray">{JSON.stringify(pendingPermission.request.args)}</Text>
              <Text>
                <Text color="green">y</Text><Text> 允许一次  </Text>
                <Text color="green">a</Text><Text> 本次会话始终允许  </Text>
                <Text color="green">p</Text><Text> 永久允许  </Text>
                <Text color="red">n</Text><Text> 拒绝</Text>
              </Text>
            </Box>
          )}

          {/* Input */}
          <Box flexShrink={0}>
            <InputBox
              onSubmit={handleSubmit}
              onCommand={handleCommand}
              disabled={isProcessing}
              disabledText={pendingPermission ? '等待权限确认...' : '思考中...'}
              mouseEventNonce={mouseEventNonce}
              onMenuToggle={(_isOpen, lines) => setMenuLines(lines)}
            />
          </Box>
        </Box>

        {/* Agent panel sidebar */}
        {showAgents && (
          <AgentPanel
            agents={agents}
            activeAgentId={activeAgentId}
            onSelect={(id) => {
              agentManager.setActiveAgent(id);
              setActiveAgentId(id);
            }}
          />
        )}
      </Box>
    </Box>
  );
};

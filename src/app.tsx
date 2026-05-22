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
    handleSubmit, addSystemMessage,
  } = useAgentManager();

  /* UI toggles */
  const [showHelp, setShowHelp] = React.useState(false);
  const [showAgents, setShowAgents] = React.useState(false);

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
  const helpRows = showHelp ? 26 : 0;
  const permissionRows = pendingPermission ? 6 : 0;
  const taskRows = showTaskPanel ? 6 : 0;
  const messageViewportHeight = Math.max(3, stdout.rows - helpRows - permissionRows - taskRows - 5);

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
        addSystemMessage('Agent execution interrupted.');
        return;
      }
      exit();
    }

    // Ctrl+C: first press interrupts, second exits
    if (key.ctrl && input === 'c') {
      if (isProcessing) {
        agentManager.getActiveAgent().abort();
        setIsProcessing(false);
        addSystemMessage('Agent execution interrupted. Press Ctrl+C again to exit.');
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
        />
      </Box>

      {/* Help overlay */}
      {showHelp && (
        <Box flexDirection="column" paddingX={1}>
          <Text bold color="cyan">Commands:</Text>
          <Text color="gray">/help, /h          Show this help</Text>
          <Text color="gray">/quit, /q, /exit   Exit</Text>
          <Text color="gray">/clear             Clear chat</Text>
          <Text color="gray">/agents, /a, Tab   Toggle agent panel</Text>
          <Text color="gray">/agent &lt;id&gt;        Switch to agent</Text>
          <Text color="gray">/new [name]        Create new agent</Text>
          <Text color="gray">/role [key] [name] Create agent with role</Text>
          <Text color="gray">/kill &lt;id&gt;         Remove agent</Text>
          <Text color="gray">/msg &lt;id&gt; &lt;text&gt;  Send message to agent</Text>
          <Text color="gray">/broadcast &lt;text&gt;  Broadcast to all</Text>
          <Text color="gray">/delegate &lt;task&gt;   Parallel task delegation</Text>
          <Text color="gray">/tasks             Toggle task panel</Text>
          <Text color="gray">/save              Save current session</Text>
          <Text color="gray">/load &lt;id&gt;         Load saved session</Text>
          <Text color="gray">/sessions          List saved sessions</Text>
          <Text color="gray">/model &lt;name&gt;      Switch model</Text>
          <Text color="gray">/provider &lt;name&gt;   Switch provider</Text>
          <Text color="gray">/skill [name]      List or activate skill</Text>
          <Text color="gray">/review [path]     Auto code review</Text>
          <Text color="gray">/pair &lt;task&gt;       Pair programming</Text>
          <Text color="gray">/swarm &lt;pat&gt; &lt;inst&gt; Multi-file processing</Text>
          <Text color="gray">/index             Build code index</Text>
          <Text color="gray">/search &lt;query&gt;    Search indexed code</Text>
          <Text color="gray">/mcp list          List MCP servers</Text>
          <Text color="gray">/mcp connect &lt;n&gt;   Connect MCP server</Text>
          <Text color="gray">/config            Show config</Text>
          <Text color="gray">PageUp/PageDown    Scroll chat history</Text>
          <Text color="gray">Shift+↑↓           Scroll chat history</Text>
          <Text color="gray">Alt+1-9            Quick switch agent</Text>
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
                  ↑ viewing older history · scroll down to return
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
              <Text bold color="yellow">Permission required</Text>
              <Text>
                <Text color="cyan">{pendingPermission.request.agentName}</Text>
                {' wants to run '}
                <Text bold>{pendingPermission.request.toolName}</Text>
              </Text>
              {pendingPermission.request.rule && (
                <Text color="gray">Matched rule: {pendingPermission.request.rule}</Text>
              )}
              <Text color="gray">{JSON.stringify(pendingPermission.request.args)}</Text>
              <Text>
                <Text color="green">y</Text><Text> allow once  </Text>
                <Text color="green">a</Text><Text> allow this exact action for session  </Text>
                <Text color="green">p</Text><Text> always allow  </Text>
                <Text color="red">n</Text><Text> deny</Text>
              </Text>
            </Box>
          )}

          {/* Input */}
          <Box flexShrink={0}>
            <InputBox
              onSubmit={handleSubmit}
              onCommand={handleCommand}
              disabled={isProcessing}
              disabledText={pendingPermission ? 'Waiting for permission...' : 'Thinking...'}
              mouseEventNonce={mouseEventNonce}
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

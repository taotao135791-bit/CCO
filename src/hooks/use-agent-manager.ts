import { useState, useEffect, useCallback, useRef } from 'react';
import { agentManager } from '../core/agent/manager.js';
import { configManager } from '../core/config/manager.js';
import { autoParallel } from '../core/agent/auto-parallel.js';
import type { AgentMessage, PermissionDecision, PermissionRequest } from '../core/agent/engine.js';
import type { AgentInfo } from '../core/agent/manager.js';
import type { TaskPlan } from '../core/agent/coordinator.js';

export interface DisplayMessage {
  id: string;
  agentId: string;
  agentName: string;
  message: AgentMessage;
  isStreaming?: boolean;
}

export interface PendingPermission {
  agentId: string;
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
}

/**
 * Hook to manage agent lifecycle, callbacks, and state synchronization.
 */
export function useAgentManager() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState('main');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [plans, setPlans] = useState<Array<{ planId: string; plan: TaskPlan }>>([]);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [tokenCounts, setTokenCounts] = useState({ input: 0, output: 0 });
  const idCounterRef = useRef(0);

  const nextId = (prefix?: string) => {
    idCounterRef.current += 1;
    return `${prefix || 'msg'}_${Date.now()}_${idCounterRef.current}`;
  };

  // Stream throttling
  const streamThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStreamRef = useRef<{ agentId: string; text: string } | null>(null);

  // Refresh agents list periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setAgents(agentManager.listAgents());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Ensure main agent exists and wire callbacks
  useEffect(() => {
    // Load project-level config and rules from cwd
    configManager.loadProjectConfig(process.cwd());
    configManager.loadProjectRules(process.cwd());

    if (!agentManager.getAgent('main')) {
      agentManager.createAgent({ id: 'main', name: 'Main' });
    }

    agentManager.onAgentMessage = (agentId, msg) => {
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (
          lastMsg && lastMsg.agentId === agentId &&
          lastMsg.message.role === 'assistant' && lastMsg.isStreaming &&
          msg.role === 'assistant'
        ) {
          if (streamThrottleRef.current) {
            clearTimeout(streamThrottleRef.current);
            streamThrottleRef.current = null;
          }
          pendingStreamRef.current = null;
          const updated = [...prev];
          updated[updated.length - 1] = { ...lastMsg, message: msg, isStreaming: false };
          return updated;
        }
        return [...prev, {
          id: nextId(agentId), agentId,
          agentName: agentManager.getAgent(agentId)?.name || agentId,
          message: msg,
        }];
      });
    };

    agentManager.onAgentStream = (agentId, text) => {
      setIsProcessing(true);
      if (pendingStreamRef.current && pendingStreamRef.current.agentId === agentId) {
        pendingStreamRef.current.text += text;
      } else {
        pendingStreamRef.current = { agentId, text };
      }
      if (!streamThrottleRef.current) {
        streamThrottleRef.current = setTimeout(() => {
          streamThrottleRef.current = null;
          const pending = pendingStreamRef.current;
          pendingStreamRef.current = null;
          if (!pending) return;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.agentId === pending.agentId &&
                lastMsg.message.role === 'assistant' && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastMsg,
                message: { ...lastMsg.message, content: lastMsg.message.content + pending.text },
              };
              return updated;
            }
            return [...prev, {
              id: nextId(`${pending.agentId}_stream`),
              agentId: pending.agentId,
              agentName: agentManager.getAgent(pending.agentId)?.name || pending.agentId,
              message: { role: 'assistant', content: pending.text },
              isStreaming: true,
            }];
          });
        }, 50);
      }
    };

    agentManager.onAgentToolUse = (agentId, name, args) => {
      setIsProcessing(true);
      setMessages((prev) => [...prev, {
        id: nextId(`${agentId}_tool`), agentId,
        agentName: agentManager.getAgent(agentId)?.name || agentId,
        message: {
          role: 'assistant', content: `Using ${name}...`,
          toolCalls: [{ id: nextId('call'), type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
      }]);
    };

    agentManager.onAgentStatusChange = () => {
      setAgents(agentManager.listAgents());
    };

    agentManager.onPlanUpdate = (planId, plan) => {
      setPlans((prev) => {
        const idx = prev.findIndex((p) => p.planId === planId);
        if (idx >= 0) { const updated = [...prev]; updated[idx] = { planId, plan }; return updated; }
        return [...prev, { planId, plan }];
      });
      setShowTaskPanel(true);
    };

    agentManager.onPermissionRequest = (agentId, request) => {
      setIsProcessing(true);
      return new Promise<PermissionDecision>((resolve) => {
        setPendingPermission({ agentId, request, resolve });
      });
    };

    agentManager.onAgentDone = () => {
      setIsProcessing(false);
      // Update token counts from active agent
      const agent = agentManager.getActiveAgent();
      if (agent) {
        setTokenCounts({ input: agent.totalInputTokens, output: agent.totalOutputTokens });
      }
      if (streamThrottleRef.current) {
        clearTimeout(streamThrottleRef.current);
        streamThrottleRef.current = null;
      }
      const pending = pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (pending) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.agentId === pending.agentId &&
              lastMsg.message.role === 'assistant' && lastMsg.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...lastMsg,
              message: { ...lastMsg.message, content: lastMsg.message.content + pending.text },
            };
            return updated;
          }
          return [...prev, {
            id: nextId(`${pending.agentId}_stream`),
            agentId: pending.agentId,
            agentName: agentManager.getAgent(pending.agentId)?.name || pending.agentId,
            message: { role: 'assistant', content: pending.text },
            isStreaming: true,
          }];
        });
      }
    };
  }, []);

  const addSystemMessage = useCallback((content: string): void => {
    setMessages((prev) => [...prev, {
      id: nextId('system'), agentId: 'system', agentName: 'System',
      message: { role: 'assistant', content },
    }]);
  }, []);

  const decidePermission = useCallback((decision: PermissionDecision) => {
    setPendingPermission((pending) => {
      if (!pending) return null;
      pending.resolve(decision);
      return null;
    });
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    if (isProcessing) return;
    const suggestion = autoParallel.analyze(value);
    if (suggestion.shouldParallel && suggestion.confidence > 60) {
      addSystemMessage(`💡 ${suggestion.reason}\n建议: 输入 /delegate ${value} 来并行执行，可能更快完成。`);
    }
    setIsProcessing(true);
    const agent = agentManager.getActiveAgent();
    setActiveAgentId(agent.id);
    setMessages((prev) => [...prev, {
      id: nextId(`${agent.id}_user`), agentId: agent.id, agentName: agent.name,
      message: { role: 'user', content: value },
    }]);
    try {
      await agent.sendUserMessage(value);
    } catch (err: any) {
      addSystemMessage(`错误: ${err.message || String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, addSystemMessage]);

  return {
    messages, setMessages, isProcessing, setIsProcessing,
    activeAgentId, setActiveAgentId, agents, plans,
    showTaskPanel, setShowTaskPanel,
    pendingPermission, decidePermission,
    handleSubmit, addSystemMessage, tokenCounts,
  };
}

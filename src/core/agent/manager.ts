import type { AgentMessage, AgentOptions, PermissionDecision, PermissionRequest } from './engine.js';
import { eventBus } from './event-bus.js';
import { agentRegistry, type AgentInfo } from './agent-registry.js';
import { coordinator, type TaskPlan } from './coordinator.js';
import type { Agent } from './engine.js';

// Re-export AgentInfo for backward compatibility
export type { AgentInfo } from './agent-registry.js';

export class AgentManager {
  onAgentMessage?: (agentId: string, msg: AgentMessage) => void;
  onAgentStream?: (agentId: string, text: string) => void;
  onAgentToolUse?: (agentId: string, name: string, args: Record<string, any>) => void;
  onAgentToolResult?: (agentId: string, name: string, result: string) => void;
  onAgentDone?: (agentId: string) => void;
  onAgentStatusChange?: (agentId: string, status: Agent['status']) => void;
  onPlanUpdate?: (planId: string, plan: TaskPlan) => void;
  onPermissionRequest?: (agentId: string, request: PermissionRequest) => Promise<PermissionDecision>;

  constructor() {
    coordinator.setOnPlanUpdate((planId, plan) => {
      this.onPlanUpdate?.(planId, plan);
    });
  }

  // Delegate to registry with callback wiring
  createAgent(options: Partial<AgentOptions> = {}, restoreSession?: boolean): Agent {
    const agent = agentRegistry.createAgent(options, restoreSession);
    const id = agent.id;

    // Wire callbacks
    agent.onMessage = (msg) => this.onAgentMessage?.(id, msg);
    agent.onStream = (text) => this.onAgentStream?.(id, text);
    agent.onToolUse = (name, args) => this.onAgentToolUse?.(id, name, args);
    agent.onToolResult = (name, result) => this.onAgentToolResult?.(id, name, result);
    agent.onDone = () => this.onAgentDone?.(id);
    agent.onStatusChange = (status) => this.onAgentStatusChange?.(id, status);
    agent.onPermissionRequest = (request) => {
      if (!this.onPermissionRequest) return Promise.resolve('deny');
      return this.onPermissionRequest(id, request);
    };

    return agent;
  }

  get agents(): Map<string, Agent> {
    return agentRegistry.agents;
  }

  getAgent(id: string): Agent | undefined {
    return agentRegistry.getAgent(id);
  }

  getActiveAgent(): Agent {
    return agentRegistry.getActiveAgent();
  }

  setActiveAgent(id: string): void {
    agentRegistry.setActiveAgent(id);
  }

  removeAgent(id: string): void {
    agentRegistry.removeAgent(id);
  }

  listAgents(): AgentInfo[] {
    return agentRegistry.listAgents();
  }

  getWorkingAgents(): AgentInfo[] {
    return agentRegistry.getWorkingAgents();
  }

  // Send message between agents
  sendAgentMessage(fromId: string, toId: string, content: string): void {
    eventBus.send(fromId, toId, 'message', content);
  }

  // Delegate a task to be parallelized by coordinator
  async delegateTask(taskDescription: string): Promise<TaskPlan> {
    return coordinator.delegateTask(taskDescription);
  }

  // Spawn a child agent for a specific task
  async spawnChildAgent(
    parentId: string,
    task: string,
    name?: string
  ): Promise<{ agentId: string; result: string }> {
    const child = this.createAgent({
      name: name || `Worker ${agentRegistry.size}`,
      parentAgent: parentId,
      systemPrompt:
        `You are a CCO worker agent. Your parent agent assigned you a specific task.\n` +
        `Focus only on the assigned task. Report back with concise results.\n` +
        `Task: ${task}`,
    });

    await child.sendUserMessage(task);

    const lastMsg = child.messages[child.messages.length - 1];
    const result = lastMsg?.role === 'assistant' ? lastMsg.content : 'No result';

    // Dispose child agent to free resources
    try { agentRegistry.removeAgent(child.id); } catch { /* not critical */ }

    return { agentId: child.id, result };
  }

  // Broadcast message to all agents
  broadcast(fromId: string, content: string): void {
    eventBus.broadcast(fromId, 'message', content);
  }

  dispose(): void {
    agentRegistry.dispose();
  }
}

export const agentManager = new AgentManager();

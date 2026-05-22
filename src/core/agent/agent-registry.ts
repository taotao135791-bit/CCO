import { Agent, type AgentOptions } from './engine.js';
import { sessionPersistence } from './persistence.js';
import { eventBus } from './event-bus.js';

export interface AgentInfo {
  id: string;
  name: string;
  status: Agent['status'];
  messageCount: number;
  parentAgent?: string;
  currentTask?: string;
}

/**
 * Pure data layer for Agent lifecycle management.
 * Breaks the circular dependency between Manager and Coordinator.
 * Both modules depend on this registry instead of each other.
 */
export class AgentRegistry {
  agents: Map<string, Agent> = new Map();
  activeAgentId: string = 'main';

  createAgent(options: Partial<AgentOptions> = {}, restoreSession?: boolean): Agent {
    const id = options.id || `agent_${this.agents.size}_${Date.now()}`;
    const agent = new Agent({
      id,
      name: options.name || `Agent ${this.agents.size + 1}`,
      systemPrompt: options.systemPrompt,
      parentAgent: options.parentAgent,
      maxIterations: options.maxIterations,
      isCoordinator: options.isCoordinator,
    });

    if (restoreSession) {
      const session = sessionPersistence.loadSession(id);
      if (session && session.messages.length > 1) {
        agent.messages = session.messages;
        agent.name = session.name;
      }
    }

    this.agents.set(id, agent);
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getActiveAgent(): Agent {
    const agent = this.agents.get(this.activeAgentId);
    if (!agent) {
      return this.createAgent({ id: 'main', name: 'Main' });
    }
    return agent;
  }

  setActiveAgent(id: string): void {
    if (this.agents.has(id)) {
      this.activeAgentId = id;
    }
  }

  removeAgent(id: string): void {
    if (id === 'main') return;
    const agent = this.agents.get(id);
    if (agent) {
      agent.dispose();
      eventBus.removeAgent(id);
      this.agents.delete(id);
    }
    if (this.activeAgentId === id) {
      this.activeAgentId = 'main';
    }
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      messageCount: a.messages.length,
      parentAgent: a.parentAgent,
      currentTask: a.currentTask,
    }));
  }

  getWorkingAgents(): AgentInfo[] {
    return this.listAgents().filter((a) => a.status === 'working');
  }

  get size(): number {
    return this.agents.size;
  }

  dispose(): void {
    for (const agent of this.agents.values()) {
      agent.dispose();
    }
    this.agents.clear();
    eventBus.dispose();
  }
}

export const agentRegistry = new AgentRegistry();

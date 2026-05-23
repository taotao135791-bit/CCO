import { Agent } from './engine.js';
import { AgentEventBus, eventBus } from './event-bus.js';
import { agentRegistry } from './agent-registry.js';
import { workspaceManager } from './workspace.js';
import { LLMClient } from '../llm/client.js';

export interface SubTask {
  id: string;
  description: string;
  agentId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  dependsOn?: string[];
}

export interface TaskPlan {
  originalTask: string;
  subTasks: SubTask[];
  parallelGroups: string[][];
}

export class Coordinator {
  private bus: AgentEventBus;
  private leadAgentId: string = 'main';
  private activePlans: Map<string, TaskPlan> = new Map();
  private onPlanUpdate?: (planId: string, plan: TaskPlan) => void;
  private llm: LLMClient;

  constructor(bus: AgentEventBus = eventBus) {
    this.bus = bus;
    this.llm = new LLMClient();
    this.setupEventListeners();
  }

  setOnPlanUpdate(cb: (planId: string, plan: TaskPlan) => void): void {
    this.onPlanUpdate = cb;
  }

  private setupEventListeners(): void {
    this.bus.subscribe('coordinator', async (event) => {
      if (event.type === 'result') {
        await this.handleResult(event.from, event.payload);
      }
      if (event.type === 'request') {
        await this.handleRequest(event.from, event.payload);
      }
    });
  }

  async delegateTask(taskDescription: string): Promise<TaskPlan> {
    const planId = `plan_${Date.now()}`;

    const leadAgent = agentRegistry.getAgent(this.leadAgentId);
    if (!leadAgent) throw new Error('Lead agent not found');

    const plan = await this.createPlan(planId, leadAgent, taskDescription);
    this.activePlans.set(planId, plan);
    this.onPlanUpdate?.(planId, plan);

    await this.executePlan(planId, plan);

    // Clean up completed plan
    this.activePlans.delete(planId);
    this.onPlanUpdate?.(planId, plan);

    return plan;
  }

  private async createPlan(planId: string, leadAgent: Agent, task: string): Promise<TaskPlan> {
    // Use LLM to break down the task intelligently
    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content:
            'You are CCO (Claude Code Open) task planner. Break down the given task into sub-tasks. ' +
            'Identify which sub-tasks can run in parallel. ' +
            'Respond ONLY in this exact format:\n\n' +
            'TASKS:\n1. [first subtask]\n2. [second subtask]\n...\n\n' +
            'GROUPS:\n- 1,2\n- 3,4\n\n' +
            'Each group is a set of task numbers that can run in parallel.',
        },
        { role: 'user', content: `Task: ${task}` },
      ]);

      const content = response.content;
      const tasksMatch = content.match(/TASKS:\n((?:\d+\.\s*[^\n]+\n?)+)/);
      const groupsMatch = content.match(/GROUPS:\n((?:-\s*[\d,\s]+\n?)+)/);

      if (tasksMatch) {
        const taskLines = tasksMatch[1]
          .trim()
          .split('\n')
          .map((l) => l.replace(/^\d+\.\s*/, '').trim())
          .filter((l) => l.length > 5);

        const groupIndices: number[][] = [];

        if (groupsMatch) {
          const parsed = groupsMatch[1]
            .trim()
            .split('\n')
            .map((g) =>
              g
                .replace(/^-\s*/, '')
                .split(',')
                .map((n) => n.trim())
                .filter((n) => /^\d+$/.test(n))
                .map((n) => parseInt(n) - 1)
                .filter((idx) => idx >= 0 && idx < taskLines.length)
            )
            .filter((g) => g.length > 0);
          groupIndices.push(...parsed);
        }

        if (taskLines.length > 0) {
          const subTasks: SubTask[] = taskLines.map((desc, i) => ({
            id: `${planId}_st_${i}`,
            description: desc,
            status: 'pending',
          }));

          // If no groups parsed, put all in one group
          if (groupIndices.length === 0) {
            groupIndices.push(subTasks.map((_, i) => i));
          }

          return {
            originalTask: task,
            subTasks,
            parallelGroups: groupIndices.map((group) =>
              group.map((idx) => subTasks[idx].id)
            ),
          };
        }
      }
    } catch {
      // Fall through to heuristic
    }

    // Fallback heuristic
    const parts = task
      .split(/[,;]|\band\b/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 10);

    if (parts.length <= 1) {
      const subTask: SubTask = {
        id: `${planId}_st_0`,
        description: task,
        status: 'pending',
      };
      return {
        originalTask: task,
        subTasks: [subTask],
        parallelGroups: [[subTask.id]],
      };
    }

    const subTasks: SubTask[] = parts.map((part, i) => ({
      id: `${planId}_st_${i}`,
      description: part,
      status: 'pending',
    }));

    return {
      originalTask: task,
      subTasks,
      parallelGroups: [subTasks.map((st) => st.id)],
    };
  }

  private async executePlan(planId: string, plan: TaskPlan): Promise<void> {
    for (const group of plan.parallelGroups) {
      await Promise.all(
        group.map(async (subTaskId) => {
          const subTask = plan.subTasks.find((st) => st.id === subTaskId);
          if (!subTask) return;

          subTask.status = 'running';
          this.onPlanUpdate?.(planId, plan);

          try {
            // Create isolated workspace for this worker to prevent file conflicts
            let workspace = null;
            try {
              workspace = workspaceManager.createWorkspace(subTask.id, process.cwd());
            } catch {
              // Workspace creation may fail (e.g., no src dir) — continue without isolation
            }

            const worker = agentRegistry.createAgent({
              name: `Worker-${subTask.id.slice(-6)}`,
              parentAgent: this.leadAgentId,
              systemPrompt:
                `You are a CCO worker agent. Your parent assigned you a specific sub-task.\n` +
                `Focus ONLY on your assigned task. Be concise. Report results clearly.\n` +
                `Do not ask clarifying questions unless absolutely critical.\n` +
                (workspace ? `Your isolated workspace is: ${workspace.rootPath}\n` : '') +
                `Your task: ${subTask.description}`,
            });

            subTask.agentId = worker.id;

            await worker.sendUserMessage(subTask.description);

            // Merge changes from isolated workspace back to original
            if (workspace) {
              try {
                const changed = workspaceManager.mergeChanges(workspace.agentId);
                if (changed.length > 0) {
                  subTask.result = `Modified files: ${changed.join(', ')}`;
                }
                workspaceManager.cleanup(workspace.agentId);
              } catch {
                // Cleanup may fail — not critical
              }
            }

            const lastMsg = worker.messages[worker.messages.length - 1];
            if (lastMsg?.role === 'assistant') {
              subTask.result = lastMsg.content;
              subTask.status = 'completed';

              this.bus.send(worker.id, this.leadAgentId, 'result', {
                subTaskId: subTask.id,
                description: subTask.description,
                result: subTask.result,
              });
            }

            // Dispose worker agent to free resources
            try {
              agentRegistry.removeAgent(worker.id);
            } catch {
              // Disposal may fail — not critical
            }

            this.onPlanUpdate?.(planId, plan);
          } catch (err: any) {
            subTask.status = 'failed';
            subTask.result = `Error: ${err.message || String(err)}`;
            this.onPlanUpdate?.(planId, plan);
          }
        })
      );
    }

    // Summarize results back to lead agent
    const summary = plan.subTasks
      .map((st) => `[${st.status.toUpperCase()}] ${st.description}\n${st.result || ''}`)
      .join('\n\n---\n\n');

    const leadAgent = agentRegistry.getAgent(this.leadAgentId);
    if (leadAgent) {
      // Send the summary as a user message to trigger synthesis
      await leadAgent.sendUserMessage(
        `All sub-tasks have been completed by parallel worker agents. ` +
        `Here are the results:\n\n${summary}\n\n` +
        `Please synthesize these results into a coherent final response for the user. ` +
        `Highlight any conflicts or inconsistencies if they exist.`
      );
    }
  }

  private async handleResult(_fromAgentId: string, _payload: any): Promise<void> {
    // Results are handled inline in executePlan
  }

  private async handleRequest(fromAgentId: string, payload: any): Promise<void> {
    const leadAgent = agentRegistry.getAgent(this.leadAgentId);
    if (!leadAgent) return;

    // Send help response back to the requesting worker via event bus
    const response = `Agent ${fromAgentId} needs help: ${payload.question}`;
    this.bus.send(this.leadAgentId, fromAgentId, 'message', { answer: response });
  }

  getActivePlans(): Array<{ planId: string; plan: TaskPlan }> {
    return Array.from(this.activePlans.entries()).map(([planId, plan]) => ({ planId, plan }));
  }
}

export const coordinator = new Coordinator();

import { agentManager } from './manager.js';
import { getRole } from './roles.js';
import { coordinator } from './coordinator.js';
import { globby } from 'globby';
import { readFileSync } from 'fs';

export type WorkflowType = 'review' | 'pair' | 'swarm';

export interface WorkflowResult {
  success: boolean;
  agents: string[];
  summary: string;
  error?: string;
}

export class WorkflowEngine {
  // /review — 自动审查当前代码库
  async reviewCode(targetPath?: string): Promise<WorkflowResult> {
    const reviewerRole = getRole('reviewer');
    if (!reviewerRole) {
      return { success: false, agents: [], summary: '', error: 'Reviewer role not found' };
    }

    const mainAgent = agentManager.getActiveAgent();
    const reviewer = agentManager.createAgent({
      name: 'Reviewer',
      systemPrompt: reviewerRole.systemPrompt,
    });

    // Find relevant files
    const files = await globby(targetPath || 'src/**/*.{ts,tsx,js,jsx}', {
      cwd: process.cwd(),
      gitignore: true,
    });

    const fileList = files.slice(0, 10).join('\n');
    const task = `Review the following files for bugs, security issues, and best practices:\n${fileList}\n\nRead each file and provide a comprehensive code review report.`;

    await reviewer.sendUserMessage(task);

    const lastMsg = reviewer.messages[reviewer.messages.length - 1];
    const review = lastMsg?.role === 'assistant' ? lastMsg.content : 'No review generated';

    // Feed review back to main agent
    mainAgent.messages.push({
      role: 'user',
      content: `Code Review Report from Reviewer Agent:\n\n${review}\n\nPlease address the issues identified above.`,
    });

    return {
      success: true,
      agents: [reviewer.id],
      summary: `Reviewed ${files.length} files. See main agent for follow-up.`,
    };
  }

  // /pair — 结对编程
  async pairProgramming(task: string): Promise<WorkflowResult> {
    const mainAgent = agentManager.getActiveAgent();

    // Create pair agent
    const pair = agentManager.createAgent({
      name: 'Pair',
      systemPrompt:
        'You are a CCO pair programming partner.\n' +
        'The user will describe a coding task. You write the initial implementation.\n' +
        'Then the main agent will review and improve your code.\n' +
        'Focus on writing clean, working code. Use tools to read/write files.',
    });

    await pair.sendUserMessage(task);

    const lastMsg = pair.messages[pair.messages.length - 1];
    const implementation = lastMsg?.role === 'assistant' ? lastMsg.content : '';

    // Main agent reviews and improves
    mainAgent.messages.push({
      role: 'user',
      content: `Your pair partner wrote this implementation:\n\n${implementation}\n\nPlease review and improve it. Apply the changes directly.`,
    });

    return {
      success: true,
      agents: [pair.id],
      summary: 'Pair programming session started. Partner wrote initial code, main agent will refine.',
    };
  }

  // /swarm — 多个 Worker 处理不同文件
  async swarm(pattern: string, instruction: string): Promise<WorkflowResult> {
    const files = await globby(pattern, {
      cwd: process.cwd(),
      gitignore: true,
    });

    if (files.length === 0) {
      return { success: false, agents: [], summary: '', error: 'No files matched pattern' };
    }

    const workerRole = getRole('worker');
    const workerAgents: string[] = [];

    // Create one worker per file (up to max)
    const maxWorkers = agentManager.getAgent('main') ? 8 : 4;
    const targetFiles = files.slice(0, maxWorkers);

    await Promise.all(
      targetFiles.map(async (file) => {
        const worker = agentManager.createAgent({
          name: `Swarm-${file.split('/').pop()?.slice(0, 8)}`,
          systemPrompt: workerRole?.systemPrompt || 'You are a CCO worker agent.',
        });
        workerAgents.push(worker.id);

        const task = `${instruction}\n\nTarget file: ${file}\n\nRead the file, apply the changes, and report what you did.`;
        await worker.sendUserMessage(task);
      })
    );

    return {
      success: true,
      agents: workerAgents,
      summary: `Swarm processed ${targetFiles.length}/${files.length} files.`,
    };
  }
}

export const workflowEngine = new WorkflowEngine();

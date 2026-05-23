import { LLMClient, type Message, type ToolCall } from '../llm/client.js';
import { BUILT_IN_TOOLS, COMPUTER_USE_TOOLS } from '../tools/definitions.js';
import { executeTool } from '../tools/executor.js';
import { configManager } from '../config/manager.js';
import { mcpManager } from '../mcp/client.js';
import { eventBus, type AgentEvent } from './event-bus.js';
import { sessionPersistence } from './persistence.js';
import { compactMessages, needsCompaction, estimateMessageTokens } from './context-manager.js';
import { suggestContextFiles, buildContextBlock } from './auto-context.js';
import { detectProject, projectDescription } from './project-detect.js';
import { cwd } from 'process';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  agent?: string;
  reasoningContent?: string;
}

export type PermissionDecision = 'allow_once' | 'allow_session' | 'allow_always' | 'deny';

export interface PermissionRequest {
  agentId: string;
  agentName: string;
  toolName: string;
  args: Record<string, any>;
  rule?: string;
}

export interface AgentOptions {
  id: string;
  name: string;
  systemPrompt?: string;
  parentAgent?: string;
  maxIterations?: number;
  isCoordinator?: boolean;
}

function getSystemPrompt(modelName: string): string {
  const rules = configManager.getProjectRules();
  const rulesSection = rules
    ? `\n\nPROJECT RULES (from .cco/rules.md):\n${rules}`
    : '';

  return `You are CCO (Claude Code Open), an open-source AI coding assistant powered by ${modelName}.

Your job is to help the user by DOING things, not just talking about them. When the user asks you to read code, edit files, run commands, or search for something — you must use the available tools to actually perform those actions.

IDENTITY:
- Name: CCO (Claude Code Open)
- Role: Expert software engineering assistant
- Philosophy: Act first, explain later. Use tools to DO, not just DESCRIBE.

AVAILABLE TOOLS:
- Read(file_path, offset?, limit?): Read file contents
- Write(file_path, content): Create or overwrite a file
- Edit(file_path, old_string, new_string): Replace exact text in a file
- MultiEdit(file_path, edits): Make multiple targeted replacements in one call. edits is an array of {old_string, new_string}
- Bash(command, timeout?): Run a terminal command
- Glob(pattern): Find files matching a pattern
- Grep(pattern, path?, include?, context_lines?, case_insensitive?): Search for regex pattern in files
- LS(path?, recursive?, max_depth?): List directory contents
- TodoWrite(todos, merge?): Track multi-step tasks
- WebSearch(query): Search the web
- WebFetch(url): Fetch content from a URL

RULES:
1. ALWAYS use tools when you need to examine code, edit files, or run commands. Never just describe what you would do.
2. When editing files, use Edit for single changes or MultiEdit for multiple changes in the same file. Use Write for new files.
3. Think step by step before acting. Wrap your reasoning in <thinking> tags so the user can see your thought process.
4. If a task has multiple independent parts, consider breaking it down.
5. You are part of a multi-agent system. Other agents may send you tasks — focus on completing them concisely.

IMPORTANT: Do not ask the user for permission to use tools. Just use them when needed.
Some tool calls may be blocked by the local permission policy. If that happens, explain the blocked action and suggest the smallest permission rule the user can add.${rulesSection}`;
}

export class Agent {
  id: string;
  name: string;
  messages: AgentMessage[];
  private llm: LLMClient;
  private maxIterations: number;
  private active: boolean = false;
  private abortController: AbortController = new AbortController();
  private unsubEventBus?: () => void;
  private pendingEvents: AgentEvent[] = [];
  parentAgent?: string;
  status: 'idle' | 'working' | 'waiting' | 'error' = 'idle';
  currentTask?: string;
  /** Max messages kept in memory before pruning old ones. */
  static readonly MAX_MESSAGES = 500;

  /* ── Token tracking ── */
  totalInputTokens: number = 0;
  totalOutputTokens: number = 0;

  /* ── Context window tracking ── */
  contextTokens: number = 0;
  contextMaxTokens: number = 128000; // default context window
  toolTimings: Array<{ tool: string; duration: number }> = [];

  onMessage?: (msg: AgentMessage) => void;
  onToolUse?: (name: string, args: Record<string, any>) => void;
  onToolResult?: (name: string, result: string) => void;
  onStream?: (text: string) => void;
  onDone?: () => void;
  onStatusChange?: (status: Agent['status']) => void;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionDecision>;
  private sessionAllowedActions: Set<string> = new Set();

  constructor(options: AgentOptions) {
    this.id = options.id;
    this.name = options.name;
    this.parentAgent = options.parentAgent;
    this.maxIterations = options.maxIterations ?? 25;
    this.llm = new LLMClient();
    const modelName = this.llm.getModel();
    this.messages = [
      {
        role: 'system',
        content: options.systemPrompt || getSystemPrompt(modelName),
      },
    ];

    // Subscribe to event bus
    this.unsubEventBus = eventBus.subscribe(this.id, (event) => {
      this.handleEvent(event);
    });
  }

  private handleEvent(event: AgentEvent): void {
    if (event.type === 'task') {
      this.pendingEvents.push(event);
      // If idle, auto-process
      if (this.status === 'idle' && !this.active) {
        this.processPendingEvent();
      }
    }
    if (event.type === 'message') {
      this.messages.push({
        role: 'user',
        content: `[Message from ${event.from}]: ${event.payload}`,
      });
      this.onMessage?.({
        role: 'user',
        content: `[Message from ${event.from}]: ${event.payload}`,
      });
    }
  }

  private async processPendingEvent(): Promise<void> {
    const event = this.pendingEvents.shift();
    if (!event) return;

    try {
      if (event.type === 'task') {
        this.currentTask = event.payload.task;
        await this.sendUserMessage(event.payload.task);
      }
    } catch (err: any) {
      this.onStream?.(`[Error processing event: ${err.message || String(err)}]\n`);
      this.setStatus('error');
    }
  }

  private getAvailableTools() {
    const tools = [...BUILT_IN_TOOLS];
    const builtInNames = new Set(BUILT_IN_TOOLS.map((t) => t.function.name));
    // Only add MCP tools that don't conflict with built-in names
    for (const mcpTool of mcpManager.getAllTools()) {
      if (!builtInNames.has(mcpTool.function.name)) {
        tools.push(mcpTool);
      }
    }
    if (configManager.get().computerUse.enabled) {
      tools.push(...COMPUTER_USE_TOOLS);
    }
    return tools;
  }

  async sendUserMessage(content: string): Promise<void> {
    // Reset abort controller for new conversation turn
    this.abortController = new AbortController();

    // Auto-context: suggest relevant files based on user message
    let enrichedContent = content;
    try {
      const suggested = suggestContextFiles(content, 5);
      if (suggested.length > 0) {
        enrichedContent = content + '\n' + buildContextBlock(suggested);
      }
    } catch { /* ignore auto-context errors */ }

    this.messages.push({ role: 'user', content: enrichedContent });
    await this.runLoop();
  }

  /**
   * Abort the current agent execution gracefully.
   * The agent will finish the current tool call and then stop.
   */
  abort(): void {
    if (this.active) {
      this.abortController.abort();
      this.setStatus('idle');
    }
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted;
  }

  async sendToolResult(toolCallId: string, content: string): Promise<void> {
    this.messages.push({
      role: 'tool',
      content,
      toolCallId,
    });
  }

  setStatus(status: Agent['status']): void {
    this.status = status;
    this.onStatusChange?.(status);
  }

  async runLoop(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.setStatus('working');

    try {
      for (let i = 0; i < this.maxIterations; i++) {
        // Check for abort signal
        if (this.abortController.signal.aborted) {
          this.messages.push({
            role: 'assistant',
            content: '[Execution interrupted by user]',
            agent: this.name,
          });
          break;
        }

        // Memory: prune old messages if too many
        this.pruneMessages();

        // Context window management: compact if approaching limit
        if (needsCompaction(this.messages, 100000, 0.8)) {
          const result = compactMessages(this.messages, { preserveRecent: 10, maxTokens: 80000 });
          if (result) {
            this.messages = result.compactedMessages;
            this.onStream?.(`[Context compacted: ${result.tokensBefore} → ${result.tokensAfter} tokens]\n`);
          }
        }

        const llmMessages: Message[] = this.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.toolCallId } as any;
          }
          if (m.role === 'assistant') {
            const msg: any = { role: 'assistant', content: m.content || '' };
            if (m.toolCalls) {
              msg.tool_calls = m.toolCalls;
            }
            if (m.reasoningContent) {
              msg.reasoning_content = m.reasoningContent;
            }
            return msg as Message;
          }
          return { role: m.role, content: m.content };
        });

        let fullContent = '';
        let reasoningContent = '';
        let reasoningStarted = false;
        let finalToolCalls: ToolCall[] | undefined;
        let finishReason: string | undefined;
        let streamError: string | null = null;

        try {
          for await (const chunk of this.llm.streamChat(llmMessages, {
            tools: this.getAvailableTools() as any,
          }, this.abortController.signal)) {
            if (chunk.reasoningContent) {
              reasoningContent += chunk.reasoningContent;
              if (!reasoningStarted) {
                reasoningStarted = true;
                this.onStream?.('<thinking>');
              }
              this.onStream?.(chunk.reasoningContent);
            }
            if (chunk.content) {
              if (reasoningStarted && reasoningContent) {
                reasoningStarted = false;
                this.onStream?.('</thinking>\n\n');
              }
              fullContent += chunk.content;
              this.onStream?.(chunk.content);
            }
            if (chunk.usage) {
              this.totalInputTokens += chunk.usage.inputTokens;
              this.totalOutputTokens += chunk.usage.outputTokens;
            }
            if (chunk.toolCalls) {
              finalToolCalls = chunk.toolCalls;
            }
            if (chunk.finishReason) {
              finishReason = chunk.finishReason;
            }
          }
        } catch (err: any) {
          streamError = err.message || String(err);
          // P0-3: Friendly error messages
          const errMsg = streamError || '';
          let friendlyError = errMsg;
          if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errMsg.includes('api_key')) {
            friendlyError = '❌ API 密钥无效或已过期。请检查配置: /config 查看当前设置，或设置新的 API Key。';
          } else if (errMsg.includes('429') || errMsg.includes('rate limit')) {
            friendlyError = '⚠️ API 请求频率超限，稍后自动重试。如果持续出现，考虑切换模型: /model <name>';
          } else if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
            friendlyError = '⏱️ 请求超时。可能是网络问题或模型服务过载，请稍后重试。';
          } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND') || errMsg.includes('network')) {
            friendlyError = '🌐 网络连接失败。请检查网络或 API Base URL (/config)。';
          } else if (errMsg.includes('model') && errMsg.includes('not found')) {
            friendlyError = `❌ 模型不存在。当前: ${this.llm.getModel()}。请切换: /model <name>`;
          }
          fullContent += `\n\n${friendlyError}`;
        }

        const displayContent = reasoningContent
          ? `<thinking>${reasoningContent}</thinking>\n\n${fullContent}`
          : fullContent;

        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: displayContent,
          toolCalls: finalToolCalls,
          reasoningContent: reasoningContent || undefined,
          agent: this.name,
        };
        this.messages.push(assistantMsg);
        this.onMessage?.(assistantMsg);

        if (streamError) {
          if (this.abortController.signal.aborted) {
            this.messages.push({
              role: 'assistant',
              content: '[Execution interrupted]',
              agent: this.name,
            });
          }
          this.setStatus('error');
          break;
        }

        if (!finalToolCalls || finalToolCalls.length === 0) {
          break;
        }

        for (const tc of finalToolCalls) {
          let args: Record<string, any>;
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            const result = `Error: Failed to parse tool arguments for '${tc.function.name}': ${tc.function.arguments}`;
            this.messages.push({ role: 'tool', content: result, toolCallId: tc.id });
            this.onToolResult?.(tc.function.name, result);
            continue;
          }
          this.onToolUse?.(tc.function.name, args);

          const permission = this.evaluatePermission(tc.function.name, args);
          const perm = permission.decision;
          if (perm === 'deny') {
            const result = `Error: Tool '${tc.function.name}' is blocked by permissions.`;
            this.messages.push({ role: 'tool', content: result, toolCallId: tc.id });
            this.onToolResult?.(tc.function.name, result);
            continue;
          }

          if (perm === 'ask') {
            const decision = await this.requestPermission({
              agentId: this.id,
              agentName: this.name,
              toolName: tc.function.name,
              args,
              rule: permission.rule,
            });

            if (decision === 'deny') {
              const result = `Permission denied: Tool '${tc.function.name}' was not executed.`;
              this.messages.push({ role: 'tool', content: result, toolCallId: tc.id });
              this.onToolResult?.(tc.function.name, result);
              continue;
            }

            if (decision === 'allow_session') {
              this.sessionAllowedActions.add(this.permissionKey(tc.function.name, args));
            }

            if (decision === 'allow_always') {
              const rule = this.createPermissionRule(tc.function.name, args);
              if (configManager.getProjectRulesPath()) {
                configManager.addProjectAllowRule(rule);
              } else {
                configManager.addAllowRule(rule);
              }
            }
          }

          if (tc.function.name.startsWith('mcp_')) {
            const parts = tc.function.name.split('_');
            const serverName = parts[1];
            const toolName = parts.slice(2).join('_');
            try {
              const result = await mcpManager.callTool(serverName, toolName, args);
              this.messages.push({ role: 'tool', content: result, toolCallId: tc.id });
              this.onToolResult?.(tc.function.name, result);
            } catch (err: any) {
              const error = `Error: ${err.message || String(err)}`;
              this.messages.push({ role: 'tool', content: error, toolCallId: tc.id });
              this.onToolResult?.(tc.function.name, error);
            }
            continue;
          }

          const toolStart = Date.now();
          const result = await executeTool(tc.function.name, args);
          const toolDuration = Date.now() - toolStart;
          this.toolTimings.push({ tool: tc.function.name, duration: toolDuration });
          let toolMsg: AgentMessage = { role: 'tool', content: result.content, toolCallId: tc.id };

          // Smart retry: if Edit failed, auto-read the file and retry once
          if (result.isError && tc.function.name === 'Edit' && result.content.includes('Could not find')) {
            const filePath = args.file_path;
            this.onStream?.(`[Auto-retry: reading ${filePath} to re-locate edit target]\n`);
            try {
              const readResult = await executeTool('Read', { file_path: filePath });
              if (!readResult.isError) {
                this.messages.push({
                  role: 'tool',
                  content: `[Auto-read for retry]:\n${readResult.content}`,
                  toolCallId: `${tc.id}_retry_read`,
                });
                const retryResult = await executeTool(tc.function.name, args);
                toolMsg = { role: 'tool', content: retryResult.content, toolCallId: tc.id };
              }
            } catch { /* ignore retry errors, use original result */ }
          }

          this.messages.push(toolMsg);
          this.onMessage?.(toolMsg);
          this.onToolResult?.(tc.function.name, toolMsg.content);
        }
      }
    } finally {
      this.active = false;
      this.setStatus('idle');
      this.onDone?.();

      // Auto-save session
      sessionPersistence.autoSave(this.id, this.name, this.messages, this.parentAgent);

      // Update context token count
      this.contextTokens = estimateMessageTokens(this.messages);

      // Process next pending event
      if (this.pendingEvents.length > 0) {
        setTimeout(() => this.processPendingEvent().catch(() => {}), 0);
      }
    }
  }

  private async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
    if (!this.onPermissionRequest) return 'deny';

    const previousStatus = this.status;
    this.setStatus('waiting');
    try {
      return await this.onPermissionRequest(request);
    } finally {
      this.setStatus(previousStatus === 'waiting' ? 'working' : previousStatus);
    }
  }

  private evaluatePermission(toolName: string, args: Record<string, any>): { decision: 'allow' | 'deny' | 'ask'; rule?: string } {
    const perms = configManager.getEffectivePermissions();
    const command = args.command || '';
    const target = this.permissionTarget(args);

    for (const rule of perms.deny) {
      if (this.matchesRule(rule, toolName, command, target)) return { decision: 'deny', rule };
    }

    if (this.sessionAllowedActions.has(this.permissionKey(toolName, args))) {
      return { decision: 'allow' };
    }

    for (const rule of perms.allow) {
      if (this.matchesRule(rule, toolName, command, target)) return { decision: 'allow', rule };
    }
    for (const rule of perms.ask) {
      if (this.matchesRule(rule, toolName, command, target)) return { decision: 'ask', rule };
    }
    return { decision: 'allow' };
  }

  private permissionKey(toolName: string, args: Record<string, any>): string {
    return `${toolName}:${JSON.stringify(args, Object.keys(args).sort())}`;
  }

  private createPermissionRule(toolName: string, args: Record<string, any>): string {
    const target = this.permissionTarget(args);
    if (!target) return toolName;
    return `${toolName}(${target})`;
  }

  private permissionTarget(args: Record<string, any>): string {
    return String(args.command || args.file_path || args.pattern || args.url || '');
  }

  private matchesRule(rule: string, toolName: string, command: string, filePath: string): boolean {
    const match = rule.match(/^([^([]+)(?:\((.*)\))?$/);
    if (!match) return false;
    const [, ruleTool, rulePattern] = match;
    if (ruleTool.trim() !== toolName) return false;
    if (!rulePattern) return true;
    const pattern = rulePattern.trim();
    const regex = new RegExp('^' + this.wildcardToRegex(pattern) + '$');
    if (toolName === 'Bash') return regex.test(command);
    return regex.test(filePath);
  }

  private wildcardToRegex(pattern: string): string {
    return pattern
      .replace(/[|\\{}()[\]^$+.:]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
  }

  dispose(): void {
    this.unsubEventBus?.();
    this.pendingEvents.length = 0;
    this.sessionAllowedActions.clear();
  }

  /**
   * Prune old messages to keep memory bounded.
   * Keeps the system prompt + the most recent `keepRecent` messages.
   * Inserts a summary placeholder for the pruned section.
   */
  pruneMessages(keepRecent = 50): void {
    if (this.messages.length <= Agent.MAX_MESSAGES) return;
    const systemMsg = this.messages[0]?.role === 'system' ? this.messages[0] : null;
    const prunedCount = this.messages.length - keepRecent - (systemMsg ? 1 : 0);
    if (prunedCount <= 0) return;
    const startIdx = systemMsg ? 1 : 0;
    const pruned = this.messages.slice(startIdx, startIdx + prunedCount);
    const recent = this.messages.slice(startIdx + prunedCount);
    const summary: AgentMessage = {
      role: 'system',
      content: `[${pruned.length} earlier messages pruned to save memory]`,
    };
    this.messages = [
      ...(systemMsg ? [systemMsg] : []),
      summary,
      ...recent,
    ];
  }
}

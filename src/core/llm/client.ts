import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Stream as OpenAIStream } from 'openai/streaming';
import type { Stream as AnthropicStream } from '@anthropic-ai/sdk/core/streaming';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { configManager } from '../config/manager.js';
import type { APIFormat } from '../config/manager.js';
import { withRetry } from './retry.js';
import { promptCache } from './cache.js';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

function debugLog(data: unknown): void {
  try {
    const dir = join(process.env.HOME || '/tmp', '.cco');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'debug.log'), JSON.stringify({ time: new Date().toISOString(), ...data as object }) + '\n');
  } catch {}
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMResponse {
  id: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMStreamChunk {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  reasoningContent?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// Convert OpenAI-format tools to Anthropic format
function toAnthropicTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as any,
  }));
}

// Convert our internal messages to Anthropic format
// Anthropic uses content blocks: text, tool_use, tool_result
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m: any) => {
      // Assistant message with tool_calls → content blocks: [text, tool_use, ...]
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const content: any[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        return { role: 'assistant', content };
      }

      // Tool result message → user message with tool_result block
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content || '',
            },
          ],
        };
      }

      // Normal text message
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content || '(empty)' };
      }

      // Array content (images etc) — filter to text only for Anthropic
      const textContent = m.content
        ?.filter((c: any) => c.type === 'text')
        ?.map((c: any) => c.text)
        ?.join('') || '(empty)';
      return { role: m.role as 'user' | 'assistant', content: textContent };
    });
}

function getSystemPrompt(messages: Message[]): string | undefined {
  const sys = messages.find((m) => m.role === 'system');
  return sys && typeof sys.content === 'string' ? sys.content : undefined;
}

export class LLMClient {
  private openaiClient?: OpenAI;
  private anthropicClient?: Anthropic;
  private provider: ReturnType<typeof configManager.getActiveProvider>;
  private format: APIFormat;

  constructor() {
    this.provider = configManager.getActiveProvider();
    this.format = this.provider.format;
    this.createClients();
  }

  private createClients(): void {
    this.provider = configManager.getActiveProvider();
    this.format = this.provider.format;

    if (this.format === 'anthropic') {
      this.anthropicClient = new Anthropic({
        apiKey: this.provider.apiKey,
        baseURL: this.provider.baseURL,
        maxRetries: 2,
      });
    } else {
      this.openaiClient = new OpenAI({
        baseURL: this.provider.baseURL,
        apiKey: this.provider.apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/claude-code-open',
          'X-Title': 'Claude Code Open',
        },
        maxRetries: 2,
        timeout: 120000,
      });
    }
  }

  refreshProvider(): void {
    this.createClients();
  }

  getModel(): string {
    return this.provider.defaultModel;
  }

  async chat(
    messages: Message[],
    options: {
      tools?: ToolDefinition[];
      stream?: boolean;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMResponse> {
    // Check cache first (non-streaming only)
    const cached = promptCache.get(messages, options.tools);
    if (cached) {
      return {
        id: `cached_${cached.key}`,
        content: cached.response,
        toolCalls: cached.toolCalls,
      };
    }

    const result = await withRetry(() => {
      if (this.format === 'anthropic') {
        return this.anthropicChat(messages, options);
      }
      return this.openaiChat(messages, options);
    }, { maxRetries: 3, baseDelay: 1000 });

    // Store result in cache
    promptCache.set(messages, result.content, result.toolCalls, options.tools);

    return result;
  }

  async *streamChat(
    messages: Message[],
    options: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      temperature?: number;
    } = {},
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (this.format === 'anthropic') {
      yield* this.anthropicStreamChat(messages, options, signal);
    } else {
      yield* this.openaiStreamChat(messages, options, signal);
    }
  }

  // ===== OpenAI format =====
  private async openaiChat(
    messages: Message[],
    options: any
  ): Promise<LLMResponse> {
    try {
      const response = await this.openaiClient!.chat.completions.create({
        model: this.provider.defaultModel,
        messages: messages as any,
        tools: options.tools as any,
        max_tokens: options.maxTokens ?? configManager.get().defaultMaxTokens,
        temperature: options.temperature ?? 0.7,
        stream: false,
      });

      const choice = response.choices[0];
      return {
        id: response.id,
        content: choice.message.content ?? '',
        reasoningContent: (choice.message as any).reasoning_content || undefined,
        toolCalls: choice.message.tool_calls as any,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err: any) {
      throw new Error(this.handleOpenAIError(err));
    }
  }

  private async *openaiStreamChat(
    messages: Message[],
    options: any,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    let stream: OpenAIStream<any>;
    try {
      debugLog({ type: 'openai-request', baseURL: this.provider.baseURL, model: this.provider.defaultModel, messages, tools: options.tools });
      stream = (await this.openaiClient!.chat.completions.create({
        model: this.provider.defaultModel,
        messages: messages as any,
        tools: options.tools as any,
        max_tokens: options.maxTokens ?? configManager.get().defaultMaxTokens,
        temperature: options.temperature ?? 0.7,
        stream: true as const,
      })) as OpenAIStream<any>;
    } catch (err: any) {
      debugLog({ type: 'openai-error', error: err.message, errorObj: err.error || null });
      const errorMsg = this.handleOpenAIError(err);
      yield { content: '', finishReason: 'error' };
      throw new Error(errorMsg);
    }

    let currentToolCalls: Map<number, ToolCall> = new Map();
    let currentReasoningContent = '';

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { content: delta.content };
        }

        const reasoning = (delta as any).reasoning_content;
        if (reasoning) {
          currentReasoningContent += reasoning;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = currentToolCalls.get(tc.index);
            if (!existing) {
              const newTc: ToolCall = {
                id: tc.id || `call_${Date.now()}_${tc.index}`,
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
              };
              currentToolCalls.set(tc.index, newTc);
            } else {
              if (tc.function?.name) existing.function.name += tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          const result: LLMStreamChunk = { content: '', finishReason: chunk.choices[0].finish_reason };
          if (currentReasoningContent) {
            result.reasoningContent = currentReasoningContent;
          }
          const tcs = Array.from(currentToolCalls.values());
          if (tcs.length > 0) {
            result.toolCalls = tcs;
          }
          yield result;
        }
      }
    } catch (err: any) {
      if (err.message?.includes('abort')) {
        yield { content: '\n[Stream aborted]', finishReason: 'stop' };
        return;
      }
      throw err;
    }
  }

  // ===== Anthropic format =====
  private async anthropicChat(
    messages: Message[],
    options: any
  ): Promise<LLMResponse> {
    try {
      const response = await this.anthropicClient!.messages.create({
        model: this.provider.defaultModel,
        max_tokens: options.maxTokens ?? configManager.get().defaultMaxTokens,
        temperature: options.temperature ?? 0.7,
        system: getSystemPrompt(messages),
        messages: toAnthropicMessages(messages),
        tools: toAnthropicTools(options.tools),
        stream: false,
      });

      // Extract content, thinking, and tool calls from response
      let content = '';
      let thinkingContent = '';
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'thinking') {
          thinkingContent += block.thinking;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      if (thinkingContent) {
        content = `<thinking>${thinkingContent}</thinking>\n\n${content}`;
      }

      return {
        id: response.id,
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      throw new Error(this.handleAnthropicError(err));
    }
  }

  private async *anthropicStreamChat(
    messages: Message[],
    options: any,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    let stream: AnthropicStream<RawMessageStreamEvent>;
    try {
      debugLog({ type: 'anthropic-request', baseURL: this.provider.baseURL, model: this.provider.defaultModel, messages: toAnthropicMessages(messages), tools: toAnthropicTools(options.tools) });
      stream = (await this.anthropicClient!.messages.create({
        model: this.provider.defaultModel,
        max_tokens: options.maxTokens ?? configManager.get().defaultMaxTokens,
        temperature: options.temperature ?? 0.7,
        system: getSystemPrompt(messages),
        messages: toAnthropicMessages(messages),
        tools: toAnthropicTools(options.tools),
        stream: true,
      })) as AnthropicStream<RawMessageStreamEvent>;
    } catch (err: any) {
      debugLog({ type: 'anthropic-error', error: err.message, errorObj: err.error || null });
      const errorMsg = this.handleAnthropicError(err);
      yield { content: '', finishReason: 'error' };
      throw new Error(errorMsg);
    }

    let currentContent = '';
    let currentToolCall: { id: string; name: string; inputJson: string } | null = null;
    let toolCalls: ToolCall[] = [];
    let thinkingBuffer = '';
    let inThinkingBlock = false;

    try {
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            currentContent += chunk.delta.text;
            yield { content: chunk.delta.text };
          } else if (chunk.delta.type === 'thinking_delta') {
            thinkingBuffer += chunk.delta.thinking;
          } else if (chunk.delta.type === 'input_json_delta') {
            if (currentToolCall) {
              currentToolCall.inputJson += chunk.delta.partial_json;
            }
          }
        } else if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              inputJson: '',
            };
          } else if (chunk.content_block.type === 'thinking') {
            inThinkingBlock = true;
          }
        } else if (chunk.type === 'content_block_stop') {
          if (inThinkingBlock) {
            inThinkingBlock = false;
            yield { content: `<thinking>${thinkingBuffer}</thinking>\n\n` };
            thinkingBuffer = '';
          }
          if (currentToolCall) {
            toolCalls.push({
              id: currentToolCall.id,
              type: 'function',
              function: {
                name: currentToolCall.name,
                arguments: currentToolCall.inputJson || '{}',
              },
            });
            currentToolCall = null;
          }
        } else if (chunk.type === 'message_stop') {
          const result: LLMStreamChunk = { content: '', finishReason: 'stop' };
          if (toolCalls.length > 0) {
            result.toolCalls = toolCalls;
          }
          yield result;
        }
      }
    } catch (err: any) {
      if (err.message?.includes('abort')) {
        yield { content: '\n[Stream aborted]', finishReason: 'stop' };
        return;
      }
      throw err;
    }
  }

  private handleOpenAIError(err: any): string {
    const msg = err.message || String(err);
    const detail = err.error ? JSON.stringify(err.error) : '';
    const fullMsg = detail ? `${msg} | ${detail}` : msg;
    if (msg.includes('400')) return `Bad Request (400): ${fullMsg}`;
    if (msg.includes('401')) return 'API Key invalid or expired';
    if (msg.includes('429')) return 'Rate limited. Please wait a moment.';
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
      return `Cannot connect to API: ${this.provider.baseURL}. Check your network or baseURL.`;
    }
    return `LLM Error: ${fullMsg}`;
  }

  private handleAnthropicError(err: any): string {
    const msg = err.message || String(err);
    const detail = err.error ? JSON.stringify(err.error) : '';
    const fullMsg = detail ? `${msg} | ${detail}` : msg;
    if (msg.includes('400') || msg.includes('invalid_request')) {
      return `Bad Request (400): ${fullMsg}`;
    }
    if (msg.includes('401') || msg.includes('authentication')) return 'API Key invalid or expired';
    if (msg.includes('429') || msg.includes('rate_limit')) return 'Rate limited. Please wait a moment.';
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
      return `Cannot connect to API: ${this.provider.baseURL}. Check your network or baseURL.`;
    }
    return `LLM Error: ${fullMsg}`;
  }
}

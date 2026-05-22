import type { AgentMessage } from './engine.js';

/**
 * Rough token estimation: ~4 chars per token for English, ~2 chars for CJK.
 * Uses a conservative mixed ratio for general content.
 */
function estimateTokens(text: string): number {
  // Count CJK characters (higher density per token)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

/**
 * Estimate total tokens across all messages.
 */
export function estimateMessageTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += estimateTokens(tc.function.arguments);
        total += 10; // tool call overhead
      }
    }
    total += 4; // role/formatting overhead per message
  }
  return total;
}

export interface CompactionResult {
  compactedMessages: AgentMessage[];
  tokensBefore: number;
  tokensAfter: number;
  summaryContent: string;
}

/**
 * Compact conversation history by summarizing older messages.
 * Preserves: system prompt + last N messages.
 * Summarizes: everything in between.
 */
export function compactMessages(
  messages: AgentMessage[],
  options: {
    preserveRecent?: number;  // Number of recent messages to keep verbatim
    maxTokens?: number;       // Target token budget
  } = {}
): CompactionResult | null {
  const {
    preserveRecent = 10,
    maxTokens = 100000,
  } = options;

  const tokensBefore = estimateMessageTokens(messages);

  // No compaction needed if within budget
  if (tokensBefore <= maxTokens) return null;

  // Must have enough messages to compact
  if (messages.length <= preserveRecent + 2) return null;

  // Separate: system prompt, older messages, recent messages
  const systemMsg = messages.find((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  if (nonSystemMessages.length <= preserveRecent) return null;

  const olderMessages = nonSystemMessages.slice(0, nonSystemMessages.length - preserveRecent);
  const recentMessages = nonSystemMessages.slice(nonSystemMessages.length - preserveRecent);

  // Build a summary of older messages
  const summaryParts: string[] = [];
  let currentSection: string[] = [];

  for (const msg of olderMessages) {
    if (msg.role === 'user') {
      if (currentSection.length > 0) {
        summaryParts.push(currentSection.join('\n'));
        currentSection = [];
      }
      summaryParts.push(`User asked: ${msg.content.slice(0, 200)}`);
    } else if (msg.role === 'assistant') {
      const content = msg.content
        .replace(/<(thinking|think)>[\s\S]*?<\/(thinking|think)>/g, '')
        .trim();
      if (content) {
        currentSection.push(`Assistant: ${content.slice(0, 300)}`);
      }
      if (msg.toolCalls?.length) {
        const toolNames = msg.toolCalls.map((tc) => tc.function.name).join(', ');
        currentSection.push(`Used tools: ${toolNames}`);
      }
    } else if (msg.role === 'tool') {
      currentSection.push(`Tool result (${msg.toolCallId?.slice(0, 8) || '?'}): ${msg.content.slice(0, 100)}...`);
    }
  }

  if (currentSection.length > 0) {
    summaryParts.push(currentSection.join('\n'));
  }

  const summaryContent = [
    '[CONVERSATION HISTORY SUMMARY]',
    `The following summarizes ${olderMessages.length} earlier messages to save context space:`,
    '',
    ...summaryParts,
    '',
    '[END SUMMARY — conversation continues below]',
  ].join('\n');

  // Build compacted message list
  const compactedMessages: AgentMessage[] = [];
  if (systemMsg) compactedMessages.push(systemMsg);

  compactedMessages.push({
    role: 'user',
    content: summaryContent,
  });

  compactedMessages.push(...recentMessages);

  const tokensAfter = estimateMessageTokens(compactedMessages);

  return {
    compactedMessages,
    tokensBefore,
    tokensAfter,
    summaryContent,
  };
}

/**
 * Check if messages are approaching the token limit and need compaction.
 * Returns true if compaction is recommended.
 */
export function needsCompaction(messages: AgentMessage[], maxTokens: number = 100000, threshold: number = 0.8): boolean {
  const currentTokens = estimateMessageTokens(messages);
  return currentTokens > maxTokens * threshold;
}

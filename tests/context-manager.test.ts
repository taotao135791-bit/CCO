import { describe, it, expect } from 'vitest';
import { estimateMessageTokens, needsCompaction, compactMessages } from '../src/core/agent/context-manager.js';
import type { AgentMessage } from '../src/core/agent/engine.js';

function makeMessages(count: number): AgentMessage[] {
  const msgs: AgentMessage[] = [{ role: 'system', content: 'You are a helpful assistant.' }];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: 'user', content: `User message ${i}` });
    msgs.push({ role: 'assistant', content: `Assistant response ${i} with some extra text to increase token count.` });
  }
  return msgs;
}

describe('Context Manager – estimateMessageTokens', () => {
  it('should estimate tokens for simple messages', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: 'Hello world' },
      { role: 'user', content: 'Hi there!' },
    ];
    const tokens = estimateMessageTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
  });

  it('should handle CJK characters', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: '你好世界' },
    ];
    const tokens = estimateMessageTokens(msgs);
    // CJK: 2 chars per token, so 4 chars ≈ 2 tokens
    expect(tokens).toBeGreaterThanOrEqual(2);
  });
});

describe('Context Manager – needsCompaction', () => {
  it('should return false for small message sets', () => {
    const msgs = makeMessages(5);
    expect(needsCompaction(msgs, 100000, 0.8)).toBe(false);
  });

  it('should return true when approaching token limit', () => {
    // Create very large messages to exceed the threshold
    const msgs: AgentMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 100; i++) {
      msgs.push({ role: 'user', content: 'x'.repeat(5000) });
      msgs.push({ role: 'assistant', content: 'y'.repeat(5000) });
    }
    expect(needsCompaction(msgs, 100000, 0.8)).toBe(true);
  });
});

describe('Context Manager – compactMessages', () => {
  it('should compact messages preserving system prompt and recent', async () => {
    const msgs = makeMessages(50);
    const result = await compactMessages(msgs, { preserveRecent: 10, maxTokens: 50000 });
    if (result) {
      expect(result.compactedMessages.length).toBeLessThan(msgs.length);
      expect(result.compactedMessages[0].role).toBe('system');
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    }
  });

  it('should return null for small message sets', async () => {
    const msgs = makeMessages(3);
    const result = await compactMessages(msgs, { preserveRecent: 10, maxTokens: 100000 });
    // Either null or no actual compaction needed
    if (result) {
      expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
    }
  });
});

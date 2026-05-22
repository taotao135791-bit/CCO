import { createHash } from 'crypto';
import type { Message } from './client.js';

interface CacheEntry {
  key: string;
  response: string;
  toolCalls?: any[];
  timestamp: number;
  hitCount: number;
}

export class PromptCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize = 50;
  private ttl = 1000 * 60 * 30; // 30 minutes

  private hash(messages: Message[], tools?: any[]): string {
    const data = JSON.stringify({ messages, tools });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  get(messages: Message[], tools?: any[]): CacheEntry | undefined {
    const key = this.hash(messages, tools);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    entry.hitCount++;
    return entry;
  }

  set(messages: Message[], response: string, toolCalls?: any[], tools?: any[]): void {
    const key = this.hash(messages, tools);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.cache.set(key, {
      key,
      response,
      toolCalls,
      timestamp: Date.now(),
      hitCount: 1,
    });
  }

  stats(): { size: number; hitRate: number; totalHits: number } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    return {
      size: this.cache.size,
      hitRate: totalHits > 0 ? totalHits / (totalHits + this.cache.size) : 0,
      totalHits,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}

export const promptCache = new PromptCache();

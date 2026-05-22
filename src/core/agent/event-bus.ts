export type EventType =
  | 'message'      // 普通消息
  | 'task'         // 任务分配
  | 'result'       // 任务结果
  | 'status'       // 状态更新
  | 'request'      // 请求帮助
  | 'broadcast';   // 广播

export interface AgentEvent {
  id: string;
  type: EventType;
  from: string;      // sender agent id
  to: string;        // target agent id or '*'
  payload: any;
  timestamp: number;
}

type EventHandler = (event: AgentEvent) => void | Promise<void>;

export class AgentEventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private history: AgentEvent[] = [];
  private maxHistory = 500;

  /** Maximum events kept in memory. Older events are discarded. */
  setMaxHistory(max: number): void {
    this.maxHistory = max;
    this.trimHistory();
  }

  private trimHistory(): void {
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  subscribe(agentId: string, handler: EventHandler): () => void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, new Set());
    }
    this.handlers.get(agentId)!.add(handler);
    return () => {
      this.handlers.get(agentId)?.delete(handler);
    };
  }

  emit(event: Omit<AgentEvent, 'id' | 'timestamp'>): void {
    const fullEvent: AgentEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };

    this.history.push(fullEvent);
    this.trimHistory();

    // Deliver to specific target
    if (event.to !== '*') {
      const targets = this.handlers.get(event.to);
      if (targets) {
        for (const handler of targets) {
          try {
            handler(fullEvent);
          } catch (err) {
            // ignore handler errors
          }
        }
      }
    }

    // Deliver to broadcast listeners
    const broadcastListeners = this.handlers.get('*');
    if (broadcastListeners) {
      for (const handler of broadcastListeners) {
        try {
          handler(fullEvent);
        } catch (err) {
          // ignore
        }
      }
    }
  }

  // Send direct message
  send(from: string, to: string, type: EventType, payload: any): void {
    this.emit({ from, to, type, payload });
  }

  // Broadcast to all
  broadcast(from: string, type: EventType, payload: any): void {
    this.emit({ from, to: '*', type, payload });
  }

  getHistory(agentId?: string): AgentEvent[] {
    if (agentId) {
      return this.history.filter((e) => e.from === agentId || e.to === agentId || e.to === '*');
    }
    return [...this.history];
  }

  getRecentEvents(since: number): AgentEvent[] {
    return this.history.filter((e) => e.timestamp > since);
  }

  /** Remove all handlers and clear history. */
  dispose(): void {
    this.handlers.clear();
    this.history.length = 0;
  }

  /** Remove all handlers for a specific agent. */
  removeAgent(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /** Clear event history. */
  clearHistory(): void {
    this.history.length = 0;
  }
}

export const eventBus = new AgentEventBus();

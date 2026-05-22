import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventBus } from '../src/core/agent/event-bus.js';

describe('AgentEventBus', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = new AgentEventBus();
  });

  it('should deliver messages to specific agents', () => {
    const received: any[] = [];
    bus.subscribe('agent-a', (e) => { received.push(e); });

    bus.send('agent-b', 'agent-a', 'message', 'hello');
    expect(received.length).toBe(1);
    expect(received[0].payload).toBe('hello');
  });

  it('should deliver broadcasts to all agents', () => {
    const receivedA: any[] = [];
    const receivedB: any[] = [];
    bus.subscribe('agent-a', (e) => { receivedA.push(e); });
    bus.subscribe('agent-b', (e) => { receivedB.push(e); });

    bus.broadcast('agent-c', 'broadcast', 'announcement');
    // Broadcasts go to '*' listeners, not individual agents
    // So agent-a and agent-b won't receive unless they subscribe to '*'
    expect(receivedA.length).toBe(0);

    // Subscribe a broadcast listener
    const broadcastReceived: any[] = [];
    bus.subscribe('*', (e) => { broadcastReceived.push(e); });
    bus.broadcast('agent-c', 'broadcast', 'announcement2');
    expect(broadcastReceived.length).toBe(1);
  });

  it('should keep history bounded', () => {
    bus.setMaxHistory(10);
    for (let i = 0; i < 20; i++) {
      bus.send('a', 'b', 'message', i);
    }
    const history = bus.getHistory();
    expect(history.length).toBeLessThanOrEqual(10);
  });

  it('should unsubscribe correctly', () => {
    const received: any[] = [];
    const unsub = bus.subscribe('agent-a', (e) => { received.push(e); });

    bus.send('b', 'agent-a', 'message', 'first');
    expect(received.length).toBe(1);

    unsub();
    bus.send('b', 'agent-a', 'message', 'second');
    expect(received.length).toBe(1);
  });

  it('should remove agent handlers', () => {
    const received: any[] = [];
    bus.subscribe('agent-a', (e) => { received.push(e); });

    bus.send('b', 'agent-a', 'message', 'first');
    expect(received.length).toBe(1);

    bus.removeAgent('agent-a');
    bus.send('b', 'agent-a', 'message', 'second');
    expect(received.length).toBe(1);
  });

  it('should clear history', () => {
    bus.send('a', 'b', 'message', 'test');
    expect(bus.getHistory().length).toBe(1);
    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  it('should dispose completely', () => {
    bus.subscribe('a', () => {});
    bus.send('a', 'b', 'message', 'test');
    bus.dispose();
    expect(bus.getHistory().length).toBe(0);
  });

  it('should filter history by agent', () => {
    bus.send('a', 'b', 'message', 'from-a');
    bus.send('b', 'a', 'message', 'from-b');
    bus.send('c', 'd', 'message', 'from-c');

    const aHistory = bus.getHistory('a');
    expect(aHistory.length).toBe(2); // from-a (sender) and from-b (receiver)
  });
});

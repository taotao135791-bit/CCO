import { describe, it, expect } from 'vitest';
import { Agent } from '../src/core/agent/engine.js';
import { agentManager } from '../src/core/agent/manager.js';
import { configManager } from '../src/core/config/manager.js';

describe('Agent', () => {
  it('should create an agent', () => {
    const agent = agentManager.createAgent({ name: 'TestAgent' });
    expect(agent.name).toBe('TestAgent');
    expect(agent.status).toBe('idle');
    expect(agent.messages.length).toBe(1);
  });

  it('should track status changes', () => {
    const agent = new Agent({ id: 'test', name: 'Test' });
    let status: string | undefined;
    agent.onStatusChange = (s) => { status = s; };
    agent.setStatus('working');
    expect(status).toBe('working');
  });

  it('should treat ask permission rules as requiring approval', () => {
    const cfg = configManager.get();
    const originalPermissions = {
      allow: [...cfg.permissions.allow],
      deny: [...cfg.permissions.deny],
      ask: [...cfg.permissions.ask],
    };
    cfg.permissions = {
      allow: [],
      deny: [],
      ask: ['Write(*.env)'],
    };

    try {
      const agent = new Agent({ id: 'perm-test', name: 'PermTest' });
      const permission = (agent as any).evaluatePermission('Write', { file_path: '.env' });
      expect(permission.decision).toBe('ask');
    } finally {
      cfg.permissions = originalPermissions;
    }
  });

  it('should remember exact allow-session permission decisions', () => {
    const cfg = configManager.get();
    const originalPermissions = {
      allow: [...cfg.permissions.allow],
      deny: [...cfg.permissions.deny],
      ask: [...cfg.permissions.ask],
    };
    cfg.permissions = {
      allow: [],
      deny: [],
      ask: ['Bash(npm *)'],
    };

    try {
      const agent = new Agent({ id: 'session-perm-test', name: 'SessionPermTest' });
      expect((agent as any).evaluatePermission('Bash', { command: 'npm test' }).decision).toBe('ask');

      const key = (agent as any).permissionKey('Bash', { command: 'npm test' });
      (agent as any).sessionAllowedActions.add(key);

      expect((agent as any).evaluatePermission('Bash', { command: 'npm test' }).decision).toBe('allow');
      expect((agent as any).evaluatePermission('Bash', { command: 'npm run build' }).decision).toBe('ask');
    } finally {
      cfg.permissions = originalPermissions;
    }
  });

  it('should keep deny rules stronger than session approvals', () => {
    const cfg = configManager.get();
    const originalPermissions = {
      allow: [...cfg.permissions.allow],
      deny: [...cfg.permissions.deny],
      ask: [...cfg.permissions.ask],
    };
    cfg.permissions = {
      allow: [],
      deny: ['Bash(rm -rf *)'],
      ask: ['Bash(*)'],
    };

    try {
      const agent = new Agent({ id: 'deny-perm-test', name: 'DenyPermTest' });
      const key = (agent as any).permissionKey('Bash', { command: 'rm -rf build' });
      (agent as any).sessionAllowedActions.add(key);

      expect((agent as any).evaluatePermission('Bash', { command: 'rm -rf build' }).decision).toBe('deny');
    } finally {
      cfg.permissions = originalPermissions;
    }
  });

  it('should create persistent allow rules from exact tool calls', () => {
    const agent = new Agent({ id: 'rule-test', name: 'RuleTest' });

    expect((agent as any).createPermissionRule('Bash', { command: 'npm test' })).toBe('Bash(npm test)');
    expect((agent as any).createPermissionRule('Write', { file_path: '.env' })).toBe('Write(.env)');
    expect((agent as any).createPermissionRule('ComputerScreenshot', {})).toBe('ComputerScreenshot');
  });

  it('should escape regex characters when matching permission rules', () => {
    const cfg = configManager.get();
    const originalPermissions = {
      allow: [...cfg.permissions.allow],
      deny: [...cfg.permissions.deny],
      ask: [...cfg.permissions.ask],
    };
    cfg.permissions = {
      allow: ['Bash(npm run test:unit)'],
      deny: [],
      ask: ['Bash(npm run test*)'],
    };

    try {
      const agent = new Agent({ id: 'regex-perm-test', name: 'RegexPermTest' });
      expect((agent as any).evaluatePermission('Bash', { command: 'npm run test:unit' }).decision).toBe('allow');
      expect((agent as any).evaluatePermission('Bash', { command: 'npm run testXunit' }).decision).toBe('ask');
    } finally {
      cfg.permissions = originalPermissions;
    }
  });
});

describe('AgentManager', () => {
  it('should list agents', () => {
    const list = agentManager.listAgents();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should remove agent', () => {
    const agent = agentManager.createAgent({ name: 'Disposable' });
    const id = agent.id;
    agentManager.removeAgent(id);
    expect(agentManager.getAgent(id)).toBeUndefined();
  });
});

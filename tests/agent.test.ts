import { describe, it, expect } from 'vitest';
import { Agent } from '../src/core/agent/engine.js';
import { agentManager } from '../src/core/agent/manager.js';
import { configManager } from '../src/core/config/manager.js';
import { suggestContextFiles, buildContextBlock } from '../src/core/agent/auto-context.js';
import { detectProject, projectDescription, recommendedGrepPatterns } from '../src/core/agent/project-detect.js';
import { estimateCost, formatCost, getModelPricing } from '../src/core/llm/cost-estimate.js';

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
  it('should track token counts', () => {
    const agent = new Agent({ id: 'token-test', name: 'TokenTest' });
    expect(agent.totalInputTokens).toBe(0);
    expect(agent.totalOutputTokens).toBe(0);
    agent.totalInputTokens = 1000;
    agent.totalOutputTokens = 500;
    expect(agent.totalInputTokens).toBe(1000);
    expect(agent.totalOutputTokens).toBe(500);
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

describe('AutoContext', () => {
  it('should return empty for empty message', () => {
    expect(suggestContextFiles('', 5)).toEqual([]);
  });

  it('should build context block from file list', () => {
    const block = buildContextBlock(['src/foo.ts', 'src/bar.ts']);
    expect(block).toContain('RELEVANT PROJECT FILES');
    expect(block).toContain('src/foo.ts');
    expect(block).toContain('src/bar.ts');
  });

  it('should return empty block for empty list', () => {
    expect(buildContextBlock([])).toBe('');
  });
});

describe('ProjectDetect', () => {
  it('should detect the current project as Node.js', () => {
    const info = detectProject(process.cwd());
    expect(info.type).toBe('node');
  });

  it('should generate project description', () => {
    const info = { type: 'node', language: 'typescript', framework: 'React' };
    const desc = projectDescription(info);
    expect(desc).toContain('node');
    expect(desc).toContain('React');
  });

  it('should return recommended grep patterns', () => {
    const info = { type: 'node', language: 'typescript' };
    const patterns = recommendedGrepPatterns(info);
    expect(patterns).toContain('*.ts');
    expect(patterns).toContain('*.tsx');
  });
});

describe('CostEstimate', () => {
  it('should look up known model pricing', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing.input).toBe(2.5);
    expect(pricing.output).toBe(10.0);
  });

  it('should return default pricing for unknown models', () => {
    const pricing = getModelPricing('totally-unknown-model');
    expect(pricing.input).toBeGreaterThan(0);
    expect(pricing.output).toBeGreaterThan(0);
  });

  it('should estimate cost correctly', () => {
    const cost = estimateCost(1_000_000, 1_000_000, 'gpt-4o');
    expect(cost).toBeCloseTo(12.5, 1); // 2.5 + 10.0
  });

  it('should format cost with appropriate precision', () => {
    expect(formatCost(0.0005)).toContain('$');
    expect(formatCost(0.5)).toBe('$0.500');
    expect(formatCost(5.0)).toBe('$5.00');
  });
});

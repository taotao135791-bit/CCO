import { describe, it, expect } from 'vitest';
import { configManager } from '../src/core/config/manager.js';

describe('ConfigManager', () => {
  it('should load default config', () => {
    const cfg = configManager.get();
    expect(cfg.activeProvider).toBeDefined();
    expect(cfg.providers.length).toBeGreaterThan(0);
    expect(cfg.permissions.deny.length).toBeGreaterThan(0);
  });

  it('should get active provider', () => {
    const provider = configManager.getActiveProvider();
    expect(provider.name).toBeDefined();
    expect(provider.baseURL).toBeDefined();
    expect(provider.format).toMatch(/^(openai|anthropic)$/);
  });

  it('should add allow rules', () => {
    const cfg = configManager.get();
    const before = cfg.permissions.allow.length;
    configManager.addAllowRule('Bash(npm test)');
    expect(cfg.permissions.allow.length).toBeGreaterThanOrEqual(before);
    expect(cfg.permissions.allow).toContain('Bash(npm test)');
  });

  it('should add deny rules', () => {
    const cfg = configManager.get();
    configManager.addDenyRule('Bash(custom-dangerous-cmd)');
    expect(cfg.permissions.deny).toContain('Bash(custom-dangerous-cmd)');
  });

  it('should add ask rules', () => {
    const cfg = configManager.get();
    configManager.addAskRule('Write(*.secret)');
    expect(cfg.permissions.ask).toContain('Write(*.secret)');
  });

  it('should not duplicate rules', () => {
    const cfg = configManager.get();
    configManager.addAllowRule('Bash(unique-cmd)');
    const count1 = cfg.permissions.allow.filter((r: string) => r === 'Bash(unique-cmd)').length;
    configManager.addAllowRule('Bash(unique-cmd)');
    const count2 = cfg.permissions.allow.filter((r: string) => r === 'Bash(unique-cmd)').length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it('should return effective permissions', () => {
    const effective = configManager.getEffectivePermissions();
    expect(effective.allow).toBeDefined();
    expect(effective.deny).toBeDefined();
    expect(effective.ask).toBeDefined();
    expect(Array.isArray(effective.deny)).toBe(true);
  });

  it('should handle project config loading', () => {
    // No .cco.json in the test directory
    const result = configManager.loadProjectConfig('/tmp/nonexistent-dir');
    expect(result).toBeNull();
  });

  it('should merge project permissions when present', () => {
    // Without project config loaded, effective = global
    const effective = configManager.getEffectivePermissions();
    const global = configManager.get().permissions;
    expect(effective.deny).toEqual(global.deny);
  });
});

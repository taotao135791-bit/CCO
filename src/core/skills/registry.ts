import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { configManager } from '../config/manager.js';

export interface Skill {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  filePattern?: string;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private loaded: boolean = false;

  loadBuiltinSkills(): void {
    // Built-in skills
    this.skills.set('code-review', {
      name: 'code-review',
      description: 'Review code for bugs, style issues, and improvements',
      prompt: 'You are CCO (Claude Code Open) acting as a senior code reviewer. Review the provided code carefully. Look for: bugs, security issues, performance problems, style violations, and missing error handling. Provide specific line-by-line feedback.',
      tools: ['Read', 'Glob'],
    });

    this.skills.set('refactor', {
      name: 'refactor',
      description: 'Refactor code to improve structure and readability',
      prompt: 'You are CCO (Claude Code Open) acting as a refactoring specialist. Analyze the code and suggest concrete refactoring steps. Focus on: reducing complexity, improving naming, extracting functions, and eliminating duplication. Apply changes using Edit tool.',
      tools: ['Read', 'Edit', 'Write'],
    });

    this.skills.set('test-gen', {
      name: 'test-gen',
      description: 'Generate unit tests for code',
      prompt: 'You are CCO (Claude Code Open) acting as a testing expert. Generate comprehensive unit tests for the provided code. Cover: happy paths, edge cases, error conditions, and boundary values. Use the testing framework appropriate for the language.',
      tools: ['Read', 'Write', 'Glob'],
    });

    this.skills.set('debug', {
      name: 'debug',
      description: 'Debug and fix issues in code',
      prompt: 'You are CCO (Claude Code Open) acting as a debugging expert. Analyze error messages, stack traces, and code to identify root causes. Use Bash to run tests and check logs. Fix issues with Edit tool. Explain your reasoning.',
      tools: ['Read', 'Edit', 'Bash', 'Glob'],
    });

    this.skills.set('doc', {
      name: 'doc',
      description: 'Generate documentation for code',
      prompt: 'You are CCO (Claude Code Open) acting as a technical writer. Generate clear, concise documentation for the provided code. Include: purpose, parameters, return values, examples, and edge cases.',
      tools: ['Read', 'Write', 'Glob'],
    });
  }

  loadFromDirectory(dir: string): void {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const skill = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        this.skills.set(skill.name, skill);
      } catch {
        // ignore invalid skill files
      }
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  init(): void {
    if (this.loaded) return;
    this.loadBuiltinSkills();
    this.loadFromDirectory(join(configManager.getConfigDir(), 'skills'));
    this.loaded = true;
  }
}

export const skillRegistry = new SkillRegistry();

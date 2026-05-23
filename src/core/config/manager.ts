import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { authStore } from '../auth/auth-store.js';

export type APIFormat = 'anthropic' | 'openai';

export interface ProviderConfig {
  name: string;
  format: APIFormat;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  models: string[];
}

export interface ProjectConfig {
  /** Project-level permission overrides */
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
  /** Default model for this project */
  defaultModel?: string;
  /** Skills to auto-load */
  skills?: string[];
}

export interface AppConfig {
  activeProvider: string;
  providers: ProviderConfig[];
  defaultMaxTokens: number;
  debug: boolean;
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  permissions: {
    allow: string[];
    deny: string[];
    ask: string[];
  };
  skills: string[];
  computerUse: {
    enabled: boolean;
    displayWidth: number;
    displayHeight: number;
  };
  multiAgent: {
    enabled: boolean;
    maxAgents: number;
  };
}

const CONFIG_DIR = join(homedir(), '.cco');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  activeProvider: 'openrouter',
  providers: [
    // DeepSeek
    {
      name: 'deepseek',
      format: 'openai',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    // Anthropic 格式（原生 Claude 协议）
    {
      name: 'anthropic',
      format: 'anthropic',
      baseURL: 'https://api.anthropic.com',
      apiKey: '',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514'],
    },
    {
      name: 'kimi',
      format: 'openai',
      baseURL: 'https://api.kimi.com/coding/v1',
      apiKey: '',
      defaultModel: 'kimi-for-coding',
      models: ['kimi-for-coding'],
    },
    // OpenAI 兼容格式
    {
      name: 'openrouter',
      format: 'openai',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '',
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      models: [
        'anthropic/claude-opus-4-20250514',
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ],
    },
    {
      name: 'openai',
      format: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    },
    {
      name: 'gemini',
      format: 'openai',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '',
      defaultModel: 'gemini-2.5-pro',
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    },
    {
      name: 'siliconflow',
      format: 'openai',
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
    },
    // 火山引擎（豆包 / Doubao）
    {
      name: 'volcengine',
      format: 'openai',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: '',
      defaultModel: 'doubao-pro-32k',
      models: ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-pro-128k', 'doubao-1-5-pro-32k'],
    },
    // 智谱 AI (GLM / ZhipuAI)
    {
      name: 'zhipu',
      format: 'openai',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      defaultModel: 'glm-4-plus',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4-long'],
    },
    // 阿里云百炼 (DashScope / Qwen)
    {
      name: 'dashscope',
      format: 'openai',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      defaultModel: 'qwen-max',
      models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-coder-plus', 'qwq-plus'],
    },
    // MiniMax
    {
      name: 'minimax',
      format: 'openai',
      baseURL: 'https://api.minimaxi.com/v1',
      apiKey: '',
      defaultModel: 'MiniMax-M2.7',
      models: ['MiniMax-M2.7', 'MiniMax-M2'],
    },
    // 小米 MiMo
    {
      name: 'xiaomi-mimo',
      format: 'openai',
      baseURL: 'https://api.xiaomimimo.com/v1',
      apiKey: '',
      defaultModel: 'MiMo-V2-Pro',
      models: ['MiMo-V2-Pro', 'MiMo-V2-Flash'],
    },
    {
      name: 'custom-openai',
      format: 'openai',
      baseURL: 'http://localhost:8080/v1',
      apiKey: '',
      defaultModel: 'default',
      models: ['default'],
    },
    {
      name: 'custom-anthropic',
      format: 'anthropic',
      baseURL: 'http://localhost:8080',
      apiKey: '',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-sonnet-4-20250514'],
    },
  ],
  defaultMaxTokens: 8192,
  debug: false,
  mcpServers: {},
  permissions: {
    allow: [],
    deny: [
      'Bash(rm -rf *)',
      'Bash(rm -r -f *)',
      'Bash(rm -fr *)',
      'Bash(sudo *)',
      'Bash(chmod 777 *)',
      'Bash(curl * | sh*)',
      'Bash(curl * | bash*)',
      'Bash(wget * | sh*)',
      'Bash(wget * | bash*)',
      'Bash(eval *)',
    ],
    ask: ['Write(*.env)'],
  },
  skills: [],
  computerUse: {
    enabled: false,
    displayWidth: 1280,
    displayHeight: 800,
  },
  multiAgent: {
    enabled: true,
    maxAgents: 4,
  },
};

export class ConfigManager {
  private config: AppConfig;
  private projectConfig: ProjectConfig | null = null;
  private projectConfigPath: string | null = null;

  constructor() {
    this.config = this.load();
  }

  private load(): AppConfig {
    try {
      if (existsSync(CONFIG_FILE)) {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return this.deepMerge(DEFAULT_CONFIG, parsed);
      }
    } catch {
      // ignore
    }
    this.save(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  /**
   * Deep merge: start from `defaults`, overlay with `overrides`.
   * Handles nested objects (computerUse, multiAgent, permissions, etc.).
   * Arrays are replaced entirely, not merged.
   */
  private deepMerge(defaults: AppConfig, overrides: Partial<AppConfig>): AppConfig {
    const result: any = { ...defaults };
    for (const key of Object.keys(overrides) as (keyof AppConfig)[]) {
      const val = overrides[key];
      if (val === undefined) continue;
      if (
        typeof val === 'object' &&
        val !== null &&
        !Array.isArray(val) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = { ...result[key], ...val };
      } else {
        result[key] = val;
      }
    }
    return result as AppConfig;
  }

  save(config?: AppConfig): void {
    if (config) this.config = config;
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  get(): AppConfig {
    return this.config;
  }

  getActiveProvider(): ProviderConfig {
    const p = this.config.providers.find((x) => x.name === this.config.activeProvider);
    if (!p) throw new Error(`Provider ${this.config.activeProvider} not found`);
    // Resolve API key from auth store if not inline
    if (!p.apiKey) {
      const storedKey = authStore.getKey(p.name);
      if (storedKey) {
        return { ...p, apiKey: storedKey };
      }
    }
    return p;
  }

  setActiveProvider(name: string): void {
    this.config.activeProvider = name;
    this.save();
  }

  /** Set API key for a provider — stores in secure auth store. */
  setProviderApiKey(name: string, apiKey: string): void {
    authStore.setKey(name, apiKey);
    // Also update inline for backward compat
    const idx = this.config.providers.findIndex((x) => x.name === name);
    if (idx !== -1) {
      this.config.providers[idx].apiKey = apiKey;
      this.save();
    }
  }

  /** Check if a provider has an API key (inline or in auth store). */
  hasApiKey(name: string): boolean {
    const p = this.config.providers.find((x) => x.name === name);
    return !!p?.apiKey || authStore.hasKey(name);
  }

  updateProvider(name: string, updates: Partial<ProviderConfig>): void {
    const idx = this.config.providers.findIndex((x) => x.name === name);
    if (idx === -1) {
      this.config.providers.push({ ...DEFAULT_CONFIG.providers[0], name, ...updates });
    } else {
      // If apiKey is being updated, also store in auth store
      if (updates.apiKey) {
        authStore.setKey(name, updates.apiKey);
      }
      this.config.providers[idx] = { ...this.config.providers[idx], ...updates };
    }
    this.save();
  }

  /** Add a custom provider. */
  addProvider(config: ProviderConfig): void {
    const idx = this.config.providers.findIndex((x) => x.name === config.name);
    if (idx === -1) {
      this.config.providers.push(config);
    } else {
      this.config.providers[idx] = config;
    }
    if (config.apiKey) {
      authStore.setKey(config.name, config.apiKey);
    }
    this.save();
  }

  addAllowRule(rule: string): void {
    if (!this.config.permissions.allow.includes(rule)) {
      this.config.permissions.allow.push(rule);
      this.save();
    }
  }

  addDenyRule(rule: string): void {
    if (!this.config.permissions.deny.includes(rule)) {
      this.config.permissions.deny.push(rule);
      this.save();
    }
  }

  addAskRule(rule: string): void {
    if (!this.config.permissions.ask.includes(rule)) {
      this.config.permissions.ask.push(rule);
      this.save();
    }
  }

  /* ── Project-level config ────────────────────────────────────────── */

  /**
   * Load project-level config from `.cco.json` in the given directory.
   * Returns the merged permissions (global + project).
   */
  loadProjectConfig(projectRoot: string): ProjectConfig | null {
    const configPath = join(resolve(projectRoot), '.cco.json');
    if (!existsSync(configPath)) {
      this.projectConfig = null;
      this.projectConfigPath = null;
      return null;
    }
    try {
      const raw = readFileSync(configPath, 'utf-8');
      this.projectConfig = JSON.parse(raw) as ProjectConfig;
      this.projectConfigPath = configPath;
      return this.projectConfig;
    } catch {
      this.projectConfig = null;
      return null;
    }
  }

  /**
   * Get effective permissions: global rules merged with project-level overrides.
   * Project deny rules always take priority.
   */
  getEffectivePermissions(): { allow: string[]; deny: string[]; ask: string[] } {
    const base = this.config.permissions;
    if (!this.projectConfig?.permissions) return { ...base };
    const pp = this.projectConfig.permissions;
    return {
      allow: [...new Set([...base.allow, ...(pp.allow || [])])],
      deny: [...new Set([...base.deny, ...(pp.deny || [])])],
      ask: [...new Set([...base.ask, ...(pp.ask || [])])],
    };
  }

  /** Save project config back to `.cco.json`. */
  saveProjectConfig(): void {
    if (!this.projectConfigPath || !this.projectConfig) return;
    writeFileSync(this.projectConfigPath, JSON.stringify(this.projectConfig, null, 2));
  }

  /**
   * Add an allow rule to the project-level `.cco.json` config.
   * Creates the file and permissions object if they don't exist.
   */
  addProjectAllowRule(rule: string): void {
    if (!this.projectConfig) {
      this.projectConfig = { permissions: { allow: [], deny: [], ask: [] } };
    }
    if (!this.projectConfig.permissions) {
      this.projectConfig.permissions = { allow: [], deny: [], ask: [] };
    }
    if (!this.projectConfig.permissions.allow) {
      this.projectConfig.permissions.allow = [];
    }
    if (!this.projectConfig.permissions.allow.includes(rule)) {
      this.projectConfig.permissions.allow.push(rule);
    }
    // If we have a path, save. Otherwise we need to create one.
    if (this.projectConfigPath) {
      this.saveProjectConfig();
    } else {
      // Create .cco.json in cwd
      const configPath = join(resolve(process.cwd()), '.cco.json');
      this.projectConfigPath = configPath;
      writeFileSync(configPath, JSON.stringify(this.projectConfig, null, 2));
    }
    // Also add to global allow for immediate effect
    this.addAllowRule(rule);
  }

  /**
   * Load project rules from `.cco/rules.md` in the given directory.
   * Returns the rules content string, or null if not found.
   */
  private projectRules: string | null = null;
  private projectRulesPath: string | null = null;

  loadProjectRules(projectRoot: string): string | null {
    const rulesPath = join(resolve(projectRoot), '.cco', 'rules.md');
    if (!existsSync(rulesPath)) {
      this.projectRules = null;
      this.projectRulesPath = null;
      return null;
    }
    try {
      this.projectRules = readFileSync(rulesPath, 'utf-8');
      this.projectRulesPath = rulesPath;
      return this.projectRules;
    } catch {
      this.projectRules = null;
      return null;
    }
  }

  getProjectRules(): string | null {
    return this.projectRules;
  }

  getProjectRulesPath(): string | null {
    return this.projectRulesPath;
  }

  getConfigDir(): string {
    return CONFIG_DIR;
  }
}

export const configManager = new ConfigManager();
